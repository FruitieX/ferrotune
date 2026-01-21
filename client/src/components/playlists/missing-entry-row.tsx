"use client";

import { useState } from "react";
import {
  AlertCircle,
  MoreHorizontal,
  Trash2,
  ArrowRightLeft,
  Check,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { FindMatchDialog } from "./find-match-dialog";
import type { MissingEntryDataResponse } from "@/lib/api/generated/MissingEntryDataResponse";

interface MissingEntryRowProps {
  playlistId: string;
  entryId: string;
  position: number;
  missing?: MissingEntryDataResponse | null;
  /** Song data for disabled library entries (has full song info but not playable) */
  song?: { title: string; artist: string; album?: string | null } | null;
  entryType?: "missing" | "notFound";
  isSelected?: boolean;
  isSelectionMode?: boolean;
  onSelect?: (id: string, selected: boolean, event?: React.MouseEvent) => void;
  onRemove?: (entryId: string) => void;
  showMoveToPosition?: boolean;
  onMoveToPosition?: (name: string, entryId: string) => void;
  /** Callback when an entry is successfully matched */
  onMatched?: () => void;
}

export function MissingEntryRow({
  playlistId,
  entryId,
  position,
  missing,
  song,
  entryType = "missing",
  isSelected,
  isSelectionMode,
  onSelect,
  onRemove,
  showMoveToPosition,
  onMoveToPosition,
  onMatched,
}: MissingEntryRowProps) {
  const [refineDialogOpen, setRefineDialogOpen] = useState(false);
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);

  // Unique ID for this entry (used for selection)
  const selectionId = `missing-${entryId}`;

  // Use song data if available (disabled library), otherwise use missing data, then defaults
  const displayTitle =
    song?.title ||
    missing?.title ||
    (entryType === "notFound" ? "Unavailable Track" : "Unknown Track");
  const displayArtist =
    song?.artist ||
    missing?.artist ||
    (entryType === "notFound" ? "Library disabled" : "Unknown Artist");
  const displayAlbum = song?.album || missing?.album;
  const displayName =
    song?.title || missing?.title || missing?.raw || displayTitle;

  // Generate effective missing data for refine match dialog
  // Use actual missing data if available, otherwise generate from song data
  const effectiveMissing =
    missing ||
    (song
      ? {
          title: song.title,
          artist: song.artist,
          album: song.album ?? null,
          duration: null,
          raw: `${song.artist} - ${song.title}`,
        }
      : null);

  const handleRemoveClick = () => {
    setRemoveDialogOpen(true);
  };

  const handleConfirmRemove = () => {
    onRemove?.(entryId);
    setRemoveDialogOpen(false);
  };

  const showCheckbox = isSelected || isSelectionMode;

  const rowContent = (
    <div
      className={cn(
        "group flex items-center gap-4 px-4 pr-6 h-[54px] rounded-md transition-colors cursor-pointer",
        "bg-orange-500/5 hover:bg-orange-500/10",
        "border-l-2 border-orange-500/50",
        isSelected && "ring-2 ring-primary bg-primary/20",
      )}
    >
      {/* Position/Index with selection checkbox overlay (matches SongRow) */}
      <div
        className="w-8 text-center shrink-0 relative cursor-pointer"
        onClick={(e) => {
          if (onSelect) {
            e.preventDefault();
            e.stopPropagation();
            onSelect(selectionId, !isSelected, e);
          }
        }}
      >
        {/* Checkbox - shows when selected, in selection mode, or on hover */}
        <div
          className={cn(
            "absolute inset-0 flex items-center justify-center transition-opacity",
            showCheckbox ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
        >
          <button
            type="button"
            role="checkbox"
            aria-checked={isSelected}
            aria-label={`Select entry ${position + 1}`}
            className={cn(
              "w-5 h-5 rounded border-2 flex items-center justify-center transition-all",
              isSelected
                ? "bg-primary border-primary text-primary-foreground"
                : "border-muted-foreground/50 hover:border-primary/50",
            )}
          >
            {isSelected && <Check className="w-3 h-3" />}
          </button>
        </div>
        {/* Track number - hidden when checkbox is visible */}
        <span
          className={cn(
            "text-sm tabular-nums text-muted-foreground transition-opacity",
            showCheckbox
              ? "opacity-0 pointer-events-none"
              : "group-hover:opacity-0 group-hover:pointer-events-none",
          )}
        >
          {position + 1}
        </span>
      </div>

      {/* Placeholder cover */}
      <div className="shrink-0 w-10 h-10 rounded bg-muted flex items-center justify-center">
        <AlertCircle className="w-5 h-5 text-orange-500" />
      </div>

      {/* Entry info */}
      <div className="flex-1 min-w-0 overflow-hidden">
        <div className="font-medium truncate text-orange-500">
          {displayTitle}
        </div>
        <div className="text-sm text-muted-foreground truncate">
          {displayArtist}
          {displayAlbum && <> • {displayAlbum}</>}
        </div>
      </div>

      {/* Actions: Dropdown menu (before Not Found badge to match SongRow) */}
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
            <DropdownMenuItem onClick={() => setRefineDialogOpen(true)}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Refine Match
            </DropdownMenuItem>
            {showMoveToPosition && onMoveToPosition && (
              <DropdownMenuItem
                onClick={() => onMoveToPosition(displayName, entryId)}
              >
                <ArrowRightLeft className="w-4 h-4 mr-2" />
                Move to Position
              </DropdownMenuItem>
            )}
            {onRemove && (
              <DropdownMenuItem
                onClick={handleRemoveClick}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Remove from Playlist
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Missing badge - clickable to open match dialog */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setRefineDialogOpen(true);
        }}
        className="hidden sm:flex shrink-0 items-center gap-1 text-xs text-orange-500 bg-orange-500/20 hover:bg-orange-500/30 px-2 py-1 rounded transition-colors cursor-pointer"
      >
        <AlertCircle className="w-3 h-3" />
        Not Found
      </button>
    </div>
  );

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{rowContent}</ContextMenuTrigger>
        <ContextMenuContent
          className="w-48"
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <ContextMenuItem onClick={() => setRefineDialogOpen(true)}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refine Match
          </ContextMenuItem>
          {showMoveToPosition && onMoveToPosition && (
            <ContextMenuItem
              onClick={() => onMoveToPosition(displayName, entryId)}
            >
              <ArrowRightLeft className="w-4 h-4 mr-2" />
              Move to Position
            </ContextMenuItem>
          )}
          {onRemove && (
            <ContextMenuItem
              onClick={handleRemoveClick}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Remove from Playlist
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>

      {/* Refine Match Dialog - show if we have missing data or song data */}
      {effectiveMissing && (
        <FindMatchDialog
          open={refineDialogOpen}
          onOpenChange={setRefineDialogOpen}
          playlistId={playlistId}
          entryId={entryId}
          position={position}
          missing={effectiveMissing}
          idPrefix="row-"
          onMatched={onMatched}
        />
      )}

      {/* Remove Confirmation Dialog */}
      <AlertDialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove missing entry?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove &quot;
              {displayName}&quot; from the playlist. This action cannot be
              undone.
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
  entryId: string;
  position: number;
  missing?: MissingEntryDataResponse | null;
  /** Song data for disabled library entries (has full song info but not playable) */
  song?: { title: string; artist: string; album?: string | null } | null;
  entryType?: "missing" | "notFound";
  isSelected?: boolean;
  isSelectionMode?: boolean;
  onSelect?: (id: string, selected: boolean, event?: React.MouseEvent) => void;
  onRemove?: (entryId: string) => void;
  showMoveToPosition?: boolean;
  onMoveToPosition?: (name: string, entryId: string) => void;
  /** Callback when an entry is successfully matched */
  onMatched?: () => void;
}

export function MissingEntryCard({
  playlistId,
  entryId,
  position,
  missing,
  song,
  entryType = "missing",
  isSelected,
  isSelectionMode,
  onSelect,
  onRemove,
  showMoveToPosition,
  onMoveToPosition,
  onMatched,
}: MissingEntryCardProps) {
  const [refineDialogOpen, setRefineDialogOpen] = useState(false);
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);

  const selectionId = `missing-${entryId}`;

  // Use song data if available (disabled library), otherwise use missing data, then defaults
  const displayTitle =
    song?.title ||
    missing?.title ||
    (entryType === "notFound" ? "Unavailable Track" : "Unknown Track");
  const displayArtist =
    song?.artist ||
    missing?.artist ||
    (entryType === "notFound" ? "Library disabled" : "Unknown Artist");
  const displayName =
    song?.title || missing?.title || missing?.raw || displayTitle;

  // Generate effective missing data for refine match dialog
  // Use actual missing data if available, otherwise generate from song data
  const effectiveMissing =
    missing ||
    (song
      ? {
          title: song.title,
          artist: song.artist,
          album: song.album ?? null,
          duration: null,
          raw: `${song.artist} - ${song.title}`,
        }
      : null);

  const handleRemoveClick = () => {
    setRemoveDialogOpen(true);
  };

  const handleConfirmRemove = () => {
    onRemove?.(entryId);
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
        isSelected && "ring-2 ring-primary bg-primary/10",
      )}
      onClick={() => setRefineDialogOpen(true)}
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
                : "opacity-0 group-hover:opacity-100",
            )}
          >
            <button
              type="button"
              className={cn(
                "w-6 h-6 rounded border-2 flex items-center justify-center transition-all",
                "bg-black/50 hover:bg-black/70",
                isSelected
                  ? "bg-primary border-primary text-primary-foreground"
                  : "border-white/80 hover:border-primary/80",
              )}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onSelect(selectionId, !isSelected, e);
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
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  setRefineDialogOpen(true);
                }}
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Refine Match
              </DropdownMenuItem>
              {showMoveToPosition && onMoveToPosition && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    onMoveToPosition(displayName, entryId);
                  }}
                >
                  <ArrowRightLeft className="w-4 h-4 mr-2" />
                  Move to Position
                </DropdownMenuItem>
              )}
              {onRemove && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveClick();
                  }}
                  className="text-destructive focus:text-destructive"
                >
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
            "bg-orange-500/20 flex items-center justify-center",
          )}
        >
          <AlertCircle className="w-12 h-12 text-orange-500" />
        </div>
      </div>

      {/* Text content */}
      <div className="space-y-1 min-w-0">
        <h3 className="font-medium text-sm truncate text-orange-500">
          {displayTitle}
        </h3>
        <p className="text-sm text-muted-foreground truncate">
          {displayArtist}
        </p>
        <div className="flex items-center gap-1 text-xs text-orange-500 bg-orange-500/20 group-hover:bg-orange-500/30 px-2 py-0.5 rounded w-fit transition-colors">
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
        <ContextMenuContent
          className="w-48"
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <ContextMenuItem onClick={() => setRefineDialogOpen(true)}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refine Match
          </ContextMenuItem>
          {showMoveToPosition && onMoveToPosition && (
            <ContextMenuItem
              onClick={() => onMoveToPosition(displayName, entryId)}
            >
              <ArrowRightLeft className="w-4 h-4 mr-2" />
              Move to Position
            </ContextMenuItem>
          )}
          {onRemove && (
            <ContextMenuItem
              onClick={handleRemoveClick}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Remove from Playlist
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>

      {/* Refine Match Dialog - show if we have missing data or song data */}
      {effectiveMissing && (
        <FindMatchDialog
          open={refineDialogOpen}
          onOpenChange={setRefineDialogOpen}
          playlistId={playlistId}
          entryId={entryId}
          position={position}
          missing={effectiveMissing}
          idPrefix="card-"
          onMatched={onMatched}
        />
      )}

      {/* Remove Confirmation Dialog */}
      <AlertDialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove missing entry?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove &quot;
              {displayName}&quot; from the playlist. This action cannot be
              undone.
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
