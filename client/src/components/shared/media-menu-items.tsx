"use client";

import Link from "next/link";
import {
  LucideIcon,
  Play,
  ListPlus,
  ListEnd,
  Heart,
  Shuffle,
  User,
  Disc,
  FolderPlus,
  Info,
  Star,
  Download,
  Tag,
  Trash2,
  X,
  Move,
  RefreshCw,
  Unlink,
  Settings,
  Ban,
  Radio,
} from "lucide-react";
import type { ReactNode } from "react";

// ===================================
// Types for polymorphic menu items
// ===================================

export interface MenuComponents {
  Item: React.ComponentType<MenuItemProps>;
  Separator: React.ComponentType;
  Sub?: React.ComponentType<{ children: ReactNode }>;
  SubTrigger?: React.ComponentType<{ children: ReactNode }>;
  SubContent?: React.ComponentType<{ children: ReactNode }>;
}

interface MenuItemProps {
  onClick?: () => void;
  asChild?: boolean;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}

// ===================================
// Reusable menu item helpers
// ===================================

interface MenuItemConfig {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  href?: string;
  className?: string;
  show?: boolean;
}

export function renderMenuItem(
  { Item }: Pick<MenuComponents, "Item">,
  config: MenuItemConfig,
  key?: string,
): ReactNode | null {
  if (config.show === false) return null;

  const Icon = config.icon;
  const content = (
    <>
      <Icon className="w-4 h-4 mr-2" />
      {config.label}
    </>
  );

  if (config.href) {
    return (
      <Item key={key} asChild>
        <Link href={config.href} onClick={config.onClick}>
          {content}
        </Link>
      </Item>
    );
  }

  return (
    <Item key={key} onClick={config.onClick} className={config.className}>
      {content}
    </Item>
  );
}

// ===================================
// Album Menu Items
// ===================================

export interface AlbumMenuItemsProps {
  components: MenuComponents;
  handlers: {
    handlePlay: () => void;
    handleShuffle: () => void;
    handlePlayNext: () => void;
    handleAddToQueue: () => void;
    handleAddToPlaylist: () => void;
    toggleStar: () => void;
    setDetailsOpen: (open: boolean) => void;
    onNavigate?: () => void;
  };
  state: {
    isStarred: boolean;
  };
  album: {
    artistId: string;
  };
}

export function AlbumMenuItems({
  components,
  handlers,
  state,
  album,
}: AlbumMenuItemsProps) {
  const { Item, Separator } = components;

  return (
    <>
      {renderMenuItem(
        { Item },
        { icon: Play, label: "Play", onClick: handlers.handlePlay },
      )}
      {renderMenuItem(
        { Item },
        { icon: Shuffle, label: "Shuffle", onClick: handlers.handleShuffle },
      )}
      <Separator />
      {renderMenuItem(
        { Item },
        {
          icon: ListPlus,
          label: "Play Next",
          onClick: handlers.handlePlayNext,
        },
      )}
      {renderMenuItem(
        { Item },
        {
          icon: ListEnd,
          label: "Add to Queue",
          onClick: handlers.handleAddToQueue,
        },
      )}
      {renderMenuItem(
        { Item },
        {
          icon: FolderPlus,
          label: "Add to Playlist",
          onClick: handlers.handleAddToPlaylist,
        },
      )}
      <Separator />
      <Item onClick={handlers.toggleStar}>
        <Heart
          className={`w-4 h-4 mr-2 ${state.isStarred ? "fill-red-500 text-red-500" : ""}`}
        />
        {state.isStarred ? "Remove from Favorites" : "Add to Favorites"}
      </Item>
      <Separator />
      {renderMenuItem(
        { Item },
        {
          icon: User,
          label: "Go to Artist",
          href: `/library/artists/details?id=${album.artistId}`,
          onClick: handlers.onNavigate,
        },
      )}
      {renderMenuItem(
        { Item },
        {
          icon: Info,
          label: "View Details",
          onClick: () => handlers.setDetailsOpen(true),
        },
      )}
    </>
  );
}

// ===================================
// Artist Menu Items
// ===================================

export interface ArtistMenuItemsProps {
  components: MenuComponents;
  handlers: {
    handlePlay: () => void;
    handleShuffle: () => void;
    handlePlayNext: () => void;
    handleAddToQueue: () => void;
    handleAddToPlaylist: () => void;
    toggleStar: () => void;
    setDetailsOpen: (open: boolean) => void;
  };
  state: {
    isStarred: boolean;
  };
}

export function ArtistMenuItems({
  components,
  handlers,
  state,
}: ArtistMenuItemsProps) {
  const { Item, Separator } = components;

  return (
    <>
      {renderMenuItem(
        { Item },
        { icon: Play, label: "Play All", onClick: handlers.handlePlay },
      )}
      {renderMenuItem(
        { Item },
        {
          icon: Shuffle,
          label: "Shuffle All",
          onClick: handlers.handleShuffle,
        },
      )}
      <Separator />
      {renderMenuItem(
        { Item },
        {
          icon: ListPlus,
          label: "Play Next",
          onClick: handlers.handlePlayNext,
        },
      )}
      {renderMenuItem(
        { Item },
        {
          icon: ListEnd,
          label: "Add to Queue",
          onClick: handlers.handleAddToQueue,
        },
      )}
      {renderMenuItem(
        { Item },
        {
          icon: FolderPlus,
          label: "Add to Playlist",
          onClick: handlers.handleAddToPlaylist,
        },
      )}
      <Separator />
      <Item onClick={handlers.toggleStar}>
        <Heart
          className={`w-4 h-4 mr-2 ${state.isStarred ? "fill-red-500 text-red-500" : ""}`}
        />
        {state.isStarred ? "Remove from Favorites" : "Add to Favorites"}
      </Item>
      <Separator />
      {renderMenuItem(
        { Item },
        {
          icon: Info,
          label: "View Details",
          onClick: () => handlers.setDetailsOpen(true),
        },
      )}
    </>
  );
}

// ===================================
// Song Menu Items (Core - for queue actions)
// ===================================

export interface SongMenuItemsCoreProps {
  components: MenuComponents;
  handlers: {
    handlePlay?: () => void;
    handleStartRadio?: () => void;
    handlePlayNext?: () => void;
    handleAddToQueue?: () => void;
    setAddToPlaylistOpen: (open: boolean) => void;
  };
  options?: {
    hideQueueActions?: boolean;
    showRemoveFromQueue?: boolean;
    onRemoveFromQueue?: () => void;
    showRemoveFromPlaylist?: boolean;
    onRemoveFromPlaylist?: () => void;
    showMoveToPosition?: boolean;
    onMoveToPosition?: () => void;
    moveToPositionLabel?: string;
    showRefineMatch?: boolean;
    onRefineMatch?: () => void;
    showUnmatch?: boolean;
    onUnmatch?: () => void;
  };
}

export function SongMenuItemsQueue({
  components,
  handlers,
  options = {},
}: SongMenuItemsCoreProps) {
  const { Item } = components;

  return (
    <>
      {!options.hideQueueActions && (
        <>
          {renderMenuItem(
            { Item },
            { icon: Play, label: "Play", onClick: handlers.handlePlay },
          )}
          {renderMenuItem(
            { Item },
            {
              icon: ListPlus,
              label: "Play Next",
              onClick: handlers.handlePlayNext,
            },
          )}
          {renderMenuItem(
            { Item },
            {
              icon: ListEnd,
              label: "Add to Queue",
              onClick: handlers.handleAddToQueue,
            },
          )}
          {handlers.handleStartRadio &&
            renderMenuItem(
              { Item },
              {
                icon: Radio,
                label: "Start Radio",
                onClick: handlers.handleStartRadio,
              },
            )}
        </>
      )}
      {renderMenuItem(
        { Item },
        {
          icon: FolderPlus,
          label: "Add to Playlist",
          onClick: () => handlers.setAddToPlaylistOpen(true),
        },
      )}
      {options.showRemoveFromQueue &&
        options.onRemoveFromQueue &&
        renderMenuItem(
          { Item },
          {
            icon: X,
            label: "Remove from Queue",
            onClick: options.onRemoveFromQueue,
          },
        )}
      {options.showMoveToPosition &&
        options.onMoveToPosition &&
        renderMenuItem(
          { Item },
          {
            icon: Move,
            label: options.moveToPositionLabel || "Move to Position",
            onClick: options.onMoveToPosition,
          },
        )}
      {options.showRemoveFromPlaylist &&
        options.onRemoveFromPlaylist &&
        renderMenuItem(
          { Item },
          {
            icon: X,
            label: "Remove from Playlist",
            onClick: options.onRemoveFromPlaylist,
            className: "text-destructive",
          },
        )}
      {options.showRefineMatch &&
        options.onRefineMatch &&
        renderMenuItem(
          { Item },
          {
            icon: RefreshCw,
            label: "Refine Match",
            onClick: options.onRefineMatch,
          },
        )}
      {options.showUnmatch &&
        options.onUnmatch &&
        renderMenuItem(
          { Item },
          {
            icon: Unlink,
            label: "Unmatch Song",
            onClick: options.onUnmatch,
            className: "text-destructive",
          },
        )}
    </>
  );
}

// ===================================
// Song Menu Items (Starring/Rating)
// ===================================

export interface SongMenuItemsStarringProps {
  components: MenuComponents;
  handlers: {
    toggleStar: () => void;
    handleToggleShuffleExclude?: () => void;
    handleToggleDisabled?: () => void;
    handleRate?: (rating: number) => void;
    handleMarkForEditing?: () => void;
    handleRescan?: () => void;
    setConfirmDeletionOpen?: (open: boolean) => void;
  };
  state: {
    isStarred: boolean;
    isExcludedFromShuffle?: boolean;
    isDisabled?: boolean;
    currentRating?: number;
  };
}

export function SongMenuItemsStarring({
  components,
  handlers,
  state,
}: SongMenuItemsStarringProps) {
  const { Item, Separator, Sub, SubTrigger, SubContent } = components;

  const hasTrackOptions =
    handlers.handleToggleShuffleExclude ||
    handlers.handleToggleDisabled ||
    handlers.handleMarkForEditing ||
    handlers.handleRescan ||
    handlers.setConfirmDeletionOpen;

  return (
    <>
      <Separator />
      <Item onClick={handlers.toggleStar}>
        <Heart
          className={`w-4 h-4 mr-2 ${state.isStarred ? "fill-red-500 text-red-500" : ""}`}
        />
        {state.isStarred ? "Remove from Favorites" : "Add to Favorites"}
      </Item>

      {/* Track Options submenu for shuffle exclude, disabled state, and editing actions */}
      {hasTrackOptions && Sub && SubTrigger && SubContent && (
        <Sub>
          <SubTrigger>
            <Settings className="w-4 h-4 mr-2" />
            Track Options
          </SubTrigger>
          <SubContent>
            {handlers.handleToggleShuffleExclude && (
              <Item onClick={handlers.handleToggleShuffleExclude}>
                <Shuffle
                  className={`w-4 h-4 mr-2 ${state.isExcludedFromShuffle ? "text-muted-foreground line-through" : ""}`}
                />
                {state.isExcludedFromShuffle
                  ? "Include in Shuffle"
                  : "Exclude from Shuffle"}
              </Item>
            )}
            {handlers.handleToggleDisabled && (
              <Item onClick={handlers.handleToggleDisabled}>
                <Ban
                  className={`w-4 h-4 mr-2 ${state.isDisabled ? "text-muted-foreground" : ""}`}
                />
                {state.isDisabled ? "Enable Track" : "Disable Track"}
              </Item>
            )}
            {(handlers.handleToggleShuffleExclude ||
              handlers.handleToggleDisabled) &&
              (handlers.handleMarkForEditing ||
                handlers.handleRescan ||
                handlers.setConfirmDeletionOpen) && <Separator />}
            {handlers.handleMarkForEditing &&
              renderMenuItem(
                { Item },
                {
                  icon: Tag,
                  label: "Mark for Editing",
                  onClick: handlers.handleMarkForEditing,
                },
              )}
            {handlers.handleRescan &&
              renderMenuItem(
                { Item },
                {
                  icon: RefreshCw,
                  label: "Rescan",
                  onClick: handlers.handleRescan,
                },
              )}
            {handlers.setConfirmDeletionOpen &&
              renderMenuItem(
                { Item },
                {
                  icon: Trash2,
                  label: "Mark for Deletion",
                  onClick: () => handlers.setConfirmDeletionOpen?.(true),
                  className: "text-destructive",
                },
              )}
          </SubContent>
        </Sub>
      )}

      {Sub && SubTrigger && SubContent && handlers.handleRate && (
        <Sub>
          <SubTrigger>
            <Star
              className={`w-4 h-4 mr-2 ${(state.currentRating ?? 0) > 0 ? "fill-yellow-500 text-yellow-500" : ""}`}
            />
            Rate {(state.currentRating ?? 0) > 0 && `(${state.currentRating})`}
          </SubTrigger>
          <SubContent>
            {[5, 4, 3, 2, 1].map((rating) => (
              <Item
                key={rating}
                onClick={() => handlers.handleRate?.(rating)}
                className={
                  (state.currentRating ?? 0) === rating ? "bg-accent" : ""
                }
              >
                {Array.from({ length: rating }).map((_, i) => (
                  <Star
                    key={i}
                    className="w-3 h-3 fill-yellow-500 text-yellow-500"
                  />
                ))}
                {Array.from({ length: 5 - rating }).map((_, i) => (
                  <Star key={i} className="w-3 h-3 text-muted-foreground" />
                ))}
              </Item>
            ))}
            <Separator />
            <Item onClick={() => handlers.handleRate?.(0)}>Remove Rating</Item>
          </SubContent>
        </Sub>
      )}
    </>
  );
}

// ===================================
// Song Menu Items (Navigation/Actions)
// ===================================

export interface SongMenuItemsNavigationProps {
  components: MenuComponents;
  handlers: {
    handleDownload?: () => void;
    setDetailsOpen: (open: boolean) => void;
    onNavigate?: () => void;
  };
  song: {
    id: string;
    artistId: string;
    albumId?: string | null;
  };
}

export function SongMenuItemsNavigation({
  components,
  handlers,
  song,
}: SongMenuItemsNavigationProps) {
  const { Item, Separator } = components;

  return (
    <>
      <Separator />
      {renderMenuItem(
        { Item },
        {
          icon: User,
          label: "Go to Artist",
          href: `/library/artists/details?id=${song.artistId}`,
          onClick: handlers.onNavigate,
        },
      )}
      {song.albumId &&
        renderMenuItem(
          { Item },
          {
            icon: Disc,
            label: "Go to Album",
            href: `/library/albums/details?id=${song.albumId}&songId=${song.id}`,
            onClick: handlers.onNavigate,
          },
        )}
      {/* Download and View Details at the bottom */}
      <Separator />
      {handlers.handleDownload &&
        renderMenuItem(
          { Item },
          {
            icon: Download,
            label: "Download",
            onClick: handlers.handleDownload,
          },
        )}
      {renderMenuItem(
        { Item },
        {
          icon: Info,
          label: "View Details",
          onClick: () => handlers.setDetailsOpen(true),
        },
      )}
    </>
  );
}
