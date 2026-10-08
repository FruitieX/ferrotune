import { Link } from "react-router-dom";
import { useRef, useEffect } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  AudioLines,
  ListMusic,
  Trash2,
  PanelRightClose,
  Disc3,
  Radio,
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
import { hapticDestructive, hapticTap } from "@/lib/utils/haptic";
import { getQueueSourceHref } from "@/lib/utils/source-links";
import { queuePanelOpenAtom } from "@/lib/store/ui";
import {
  serverQueueStateAtom,
  isQueueLoadingAtom,
  clearQueueAtom,
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
    case "songRadio":
      return <Radio className={className} />;
    case "genre":
      return <Music2 className={className} />;
    case "search":
      return <Search className={className} />;
    case "favorites":
      return <Heart className={className} />;
    case "history":
      return <History className={className} />;
    case "similarTracks":
      return <AudioLines className={className} />;
    default:
      return <ListMusic className={className} />;
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
  const link = getQueueSourceHref(queueSource);

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
        to={link}
        className="block px-4 py-2 border-b border-border hover:bg-muted/50 active:bg-muted/70 transition-colors touch-manipulation"
      >
        {content}
      </Link>
    );
  }

  return <div className="px-4 py-2 border-b border-border">{content}</div>;
}

interface QueuePanelBodyProps {
  /** Whether the panel is showing (scrolls to now playing when it opens). */
  isOpen: boolean;
  onClose: () => void;
  /** Visual style: the app sidebar or the translucent fullscreen panel. */
  variant?: "sidebar" | "fullscreen";
}

/** Header, "Playing from" and the virtualized queue list. */
function QueuePanelBody({
  isOpen,
  onClose,
  variant = "sidebar",
}: QueuePanelBodyProps) {
  const queueState = useAtomValue(serverQueueStateAtom);
  const isQueueLoading = useAtomValue(isQueueLoadingAtom);
  const clearQueue = useSetAtom(clearQueueAtom);
  const queueDisplayRef = useRef<VirtualizedQueueDisplayHandle>(null);

  // Track if we've already scrolled for this open state
  const hasScrolledRef = useRef(false);

  // Reset scroll tracking when the panel closes
  useEffect(() => {
    if (!isOpen) {
      hasScrolledRef.current = false;
    }
  }, [isOpen]);

  // Auto-scroll to current song when the panel opens (only once per open)
  useEffect(() => {
    if (
      isOpen &&
      !isQueueLoading &&
      queueState &&
      queueState.totalCount > 0 &&
      !hasScrolledRef.current
    ) {
      hasScrolledRef.current = true;
      // Wait for the layout animation to finish and the scroll container to
      // have stable dimensions before scrolling to the current track.
      const rafId = requestAnimationFrame(() => {
        queueDisplayRef.current?.scrollToNowPlaying("auto");
      });
      return () => cancelAnimationFrame(rafId);
    }
  }, [isOpen, isQueueLoading, queueState]);

  const handleClearQueue = () => {
    const trackCount = queueState?.totalCount ?? 0;
    hapticDestructive();
    clearQueue();
    toast.success(`Cleared ${trackCount} tracks from queue`);
  };

  const handleJumpToNowPlaying = () => {
    hapticTap();
    queueDisplayRef.current?.scrollToNowPlaying("smooth");
  };

  const borderClass =
    variant === "fullscreen" ? "border-white/10" : "border-border";

  return (
    <>
      {/* Header */}
      <div
        className={cn(
          "flex items-center justify-between px-4 py-3 border-b shrink-0",
          borderClass,
        )}
      >
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
            onClick={() => {
              hapticTap();
              onClose();
            }}
            className="h-8 w-8"
            aria-label="Close queue"
          >
            <PanelRightClose className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <QueueSourceDisplay />
      <VirtualizedQueueDisplay
        ref={queueDisplayRef}
        key={queueState?.source?.instanceId ?? "no-queue"}
      />
    </>
  );
}

/**
 * Desktop-only queue sidebar.
 * Used on screens xl and larger.
 */
export function QueueSidebar() {
  const hydrated = useHydrated();
  const [isOpen, setIsOpen] = useAtom(queuePanelOpenAtom);

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
            <QueuePanelBody isOpen={isOpen} onClose={() => setIsOpen(false)} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.aside>
  );
}

/**
 * Queue panel beside the desktop fullscreen player, filling the space the
 * centered artwork leaves on wide screens.
 */
export function FullscreenQueuePanel({ onClose }: { onClose: () => void }) {
  return (
    <motion.aside
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      aria-label="Queue"
      data-testid="fullscreen-queue-panel"
      className="flex flex-col min-h-0 shrink-0 my-4 mr-4 rounded-xl border border-white/10 bg-black/30 backdrop-blur-xl overflow-hidden"
      style={{ width: QUEUE_SIDEBAR_WIDTH + 40 }}
    >
      <QueuePanelBody isOpen onClose={onClose} variant="fullscreen" />
    </motion.aside>
  );
}
