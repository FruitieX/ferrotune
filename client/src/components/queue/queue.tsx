"use client";

import { useRef, useEffect } from "react";
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
import { useHydrated } from "@/lib/hooks/use-hydrated";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  VirtualizedQueueDisplay,
  type VirtualizedQueueDisplayHandle,
} from "@/components/queue/virtualized-queue-display";

const QUEUE_SIDEBAR_WIDTH = 360;

// Queue source info type for display
interface QueueSourceInfo {
  type: QueueSourceType | string;
  id?: string | null;
  name?: string | null;
}

// Queue source icon component - renders the appropriate icon based on source type
function QueueSourceIcon({
  type,
  className,
}: {
  type: string;
  className?: string;
}) {
  switch (type) {
    case "library":
      return <Library className={className} />;
    case "album":
      return <Disc3 className={className} />;
    case "artist":
      return <User className={className} />;
    case "playlist":
      return <PlaylistIcon className={className} />;
    case "genre":
      return <Music2 className={className} />;
    case "search":
      return <Search className={className} />;
    case "favorites":
      return <Heart className={className} />;
    case "history":
      return <History className={className} />;
    default:
      return <ListMusic className={className} />;
  }
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
      return source.name
        ? `/library/genres/details?name=${encodeURIComponent(source.name)}`
        : null;
    default:
      return null;
  }
}

// Queue source display component (desktop only - mobile version is in mobile-queue-sheet.tsx)
function QueueSourceDisplay() {
  const queueState = useAtomValue(serverQueueStateAtom);

  // Don't show if queue is empty or no meaningful source
  if (
    !queueState ||
    queueState.totalCount === 0 ||
    !queueState.source ||
    queueState.source.type === "other"
  ) {
    return null;
  }

  const queueSource = queueState.source;
  const link = getQueueSourceLink(queueSource);

  const content = (
    <div
      className={cn("flex items-center gap-2 text-muted-foreground text-xs")}
    >
      <QueueSourceIcon
        type={queueSource.type}
        className="w-3.5 h-3.5 shrink-0"
      />
      <span className="truncate">
        Playing from{" "}
        {queueSource.name ||
          (queueSource.type === "library" ? "Library" : "Queue")}
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

  return <div className="px-4 py-2 border-b border-border">{content}</div>;
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

  // Track if we've already scrolled for this open state
  const hasScrolledRef = useRef(false);

  // Reset scroll tracking when sidebar closes
  useEffect(() => {
    if (!isOpen) {
      hasScrolledRef.current = false;
    }
  }, [isOpen]);

  // Auto-scroll to current song when queue sidebar opens (only once per open)
  useEffect(() => {
    if (
      hydrated &&
      isOpen &&
      !isQueueLoading &&
      queueState &&
      queueState.totalCount > 0 &&
      !hasScrolledRef.current
    ) {
      hasScrolledRef.current = true;
      // Use a small delay to ensure the virtualized list is mounted
      const timer = setTimeout(() => {
        queueDisplayRef.current?.scrollToNowPlaying("auto");
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [hydrated, isOpen, isQueueLoading, queueState]);

  const handleClearQueue = () => {
    const trackCount = queueState?.totalCount ?? 0;
    clearQueue();
    toast.success(`Cleared ${trackCount} tracks from queue`);
  };

  const handleJumpToNowPlaying = () => {
    queueDisplayRef.current?.scrollToNowPlaying("smooth");
  };

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

            <QueueSourceDisplay />
            <VirtualizedQueueDisplay ref={queueDisplayRef} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.aside>
  );
}
