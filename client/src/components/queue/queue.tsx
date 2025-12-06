"use client";

import { useCallback, useRef } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  ListMusic,
  Trash2,
  PanelRightClose,
  Disc3,
  User,
  ListMusic as PlaylistIcon,
  Music2,
  Search,
  Heart,
  History,
  Library,
  ListStart,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { queuePanelOpenAtom } from "@/lib/store/ui";
import {
  serverQueueStateAtom,
  isQueueLoadingAtom,
  clearQueueAtom,
  type QueueSourceType,
} from "@/lib/store/server-queue";
import { useIsDesktop } from "@/lib/hooks/use-media-query";
import { useHydrated } from "@/lib/hooks/use-hydrated";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { VirtualizedQueueDisplay, type VirtualizedQueueDisplayHandle } from "@/components/queue/virtualized-queue-display";

const QUEUE_SIDEBAR_WIDTH = 360;

// Queue source info type for display
interface QueueSourceInfo {
  type: QueueSourceType | string;
  id?: string | null;
  name?: string | null;
}

// Get icon component for queue source type
function getQueueSourceIcon(type: string) {
  switch (type) {
    case "library":
      return Library;
    case "album":
      return Disc3;
    case "artist":
      return User;
    case "playlist":
      return PlaylistIcon;
    case "genre":
      return Music2;
    case "search":
      return Search;
    case "favorites":
      return Heart;
    case "history":
      return History;
    default:
      return ListMusic;
  }
}

// Get display label for queue source
function getQueueSourceLabel(source: QueueSourceInfo): string {
  const typeLabels: Record<string, string> = {
    library: "Library",
    album: "Album",
    artist: "Artist",
    playlist: "Playlist",
    genre: "Genre",
    search: "Search Results",
    favorites: "Favorites",
    history: "Recently Played",
    other: "Queue",
  };

  if (source.name) {
    return `${typeLabels[source.type] || "Queue"}: ${source.name}`;
  }
  return typeLabels[source.type] || "Queue";
}

// Get link for queue source (if navigable)
function getQueueSourceLink(source: QueueSourceInfo): string | null {
  switch (source.type) {
    case "album":
      return source.id ? `/library/albums/details?id=${source.id}` : null;
    case "artist":
      return source.id ? `/library/artists/details?id=${source.id}` : null;
    case "playlist":
      return source.id ? `/playlists/details?id=${source.id}` : null;
    case "genre":
      return source.name ? `/library/genres/details?name=${encodeURIComponent(source.name)}` : null;
    default:
      return null;
  }
}

// Queue source display component
function QueueSourceDisplay({ variant }: { variant: "mobile" | "desktop" }) {
  const queueState = useAtomValue(serverQueueStateAtom);

  // Don't show if queue is empty or no meaningful source
  if (!queueState || queueState.totalCount === 0 || queueState.source.type === "other") {
    return null;
  }

  const queueSource = queueState.source;
  const Icon = getQueueSourceIcon(queueSource.type);
  const link = getQueueSourceLink(queueSource);
  const isMobile = variant === "mobile";

  const content = (
    <div className={cn(
      "flex items-center gap-2 text-muted-foreground",
      isMobile ? "text-sm" : "text-xs"
    )}>
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span className="truncate">
        Playing from {queueSource.name || (queueSource.type === "library" ? "Library" : "Queue")}
      </span>
    </div>
  );

  if (link) {
    return (
      <Link 
        href={link} 
        className="block px-4 py-2 border-b border-border hover:bg-muted/50 transition-colors"
      >
        {content}
      </Link>
    );
  }

  return (
    <div className="px-4 py-2 border-b border-border">
      {content}
    </div>
  );
}

/**
 * Mobile-only queue panel (Sheet/Drawer).
 * Used on screens smaller than xl breakpoint.
 */
export function QueuePanel() {
  const isDesktop = useIsDesktop();
  const [isOpen, setIsOpen] = useAtom(queuePanelOpenAtom);
  const queueState = useAtomValue(serverQueueStateAtom);
  const isQueueLoading = useAtomValue(isQueueLoadingAtom);
  const clearQueue = useSetAtom(clearQueueAtom);
  const queueDisplayRef = useRef<VirtualizedQueueDisplayHandle>(null);

  const handleClearQueue = useCallback(() => {
    const trackCount = queueState?.totalCount ?? 0;
    clearQueue();
    toast.success(`Cleared ${trackCount} tracks from queue`);
  }, [queueState, clearQueue]);

  const handleJumpToNowPlaying = useCallback(() => {
    queueDisplayRef.current?.scrollToNowPlaying("smooth");
  }, []);

  // Don't render the Sheet on desktop - use QueueSidebar instead
  if (isDesktop) {
    return null;
  }

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetContent side="right" className="w-full sm:w-[400px] p-0 flex flex-col">
        <SheetHeader className="px-4 py-3 border-b border-border">
          <div className="flex items-center justify-between pr-8">
            <SheetTitle className="flex items-center gap-2">
              <ListMusic className="w-5 h-5" />
              Queue
            </SheetTitle>
            <div className="flex items-center gap-1">
              {queueState && queueState.totalCount > 0 && !isQueueLoading && (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleJumpToNowPlaying}
                        className="text-muted-foreground hover:text-foreground h-8 w-8"
                        aria-label="Jump to now playing"
                      >
                        <ListStart className="w-4 h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Jump to now playing</TooltipContent>
                  </Tooltip>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClearQueue}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Clear
                  </Button>
                </>
              )}
            </div>
          </div>
        </SheetHeader>

        <QueueSourceDisplay variant="mobile" />
        <VirtualizedQueueDisplay ref={queueDisplayRef} />
      </SheetContent>
    </Sheet>
  );
}

/**
 * Desktop-only queue sidebar.
 * Used on screens xl and larger.
 */
export function QueueSidebar() {
  const hydrated = useHydrated();
  const [isOpen, setIsOpen] = useAtom(queuePanelOpenAtom);
  const queueState = useAtomValue(serverQueueStateAtom);
  const isQueueLoading = useAtomValue(isQueueLoadingAtom);
  const clearQueue = useSetAtom(clearQueueAtom);
  const queueDisplayRef = useRef<VirtualizedQueueDisplayHandle>(null);

  const handleClearQueue = useCallback(() => {
    const trackCount = queueState?.totalCount ?? 0;
    clearQueue();
    toast.success(`Cleared ${trackCount} tracks from queue`);
  }, [queueState, clearQueue]);

  const handleJumpToNowPlaying = useCallback(() => {
    queueDisplayRef.current?.scrollToNowPlaying("smooth");
  }, []);

  // Wait for hydration to avoid flash
  if (!hydrated) {
    return null;
  }

  return (
    <motion.aside
      initial={{ width: 0 }}
      animate={{ width: isOpen ? QUEUE_SIDEBAR_WIDTH : 0 }}
      transition={{ duration: 0.2, ease: "easeInOut" }}
      className="shrink-0 overflow-hidden border-l border-border bg-card hidden xl:flex"
    >
      <AnimatePresence mode="wait">
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="flex flex-col flex-1 min-h-0"
            style={{ width: QUEUE_SIDEBAR_WIDTH }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <h2 className="font-semibold flex items-center gap-2 text-sm">
                <ListMusic className="w-4 h-4" />
                Queue
              </h2>
              <div className="flex items-center gap-1">
                {queueState && queueState.totalCount > 0 && !isQueueLoading && (
                  <>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={handleJumpToNowPlaying}
                          className="text-muted-foreground hover:text-foreground h-8 w-8"
                          aria-label="Jump to now playing"
                        >
                          <ListStart className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Jump to now playing</TooltipContent>
                    </Tooltip>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleClearQueue}
                      className="text-muted-foreground hover:text-destructive h-8 px-2 text-xs"
                    >
                      <Trash2 className="w-4 h-4 mr-1" />
                      Clear
                    </Button>
                  </>
                )}
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={() => setIsOpen(false)} 
                  className="h-8 w-8" 
                  aria-label="Close queue"
                >
                  <PanelRightClose className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <QueueSourceDisplay variant="desktop" />
            <VirtualizedQueueDisplay ref={queueDisplayRef} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.aside>
  );
}
