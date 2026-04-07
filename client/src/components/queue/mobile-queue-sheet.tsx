"use client";

import { useRef, useEffect, useLayoutEffect, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import Link from "next/link";
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useTransform,
  animate,
  type PanInfo,
} from "framer-motion";
import { toast } from "sonner";
import {
  ListMusic,
  Trash2,
  X,
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
import {
  cleanUpHistoryState,
  isHistoryCleanup,
} from "@/lib/hooks/use-back-button-close";
import {
  queuePanelOpenAtom,
  fullscreenPlayerOpenAtom,
  preferencesLoadedAtom,
} from "@/lib/store/ui";
import { accountKey, serverConnectionAtom } from "@/lib/store/auth";
import {
  serverQueueStateAtom,
  isQueueLoadingAtom,
  clearQueueAtom,
  type QueueSourceType,
} from "@/lib/store/server-queue";
import { Button } from "@/components/ui/button";
import {
  VirtualizedQueueDisplay,
  type VirtualizedQueueDisplayHandle,
} from "@/components/queue/virtualized-queue-display";

const SHEET_WIDTH = 400; // px

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

// Queue source display component
function QueueSourceDisplay({ onNavigate }: { onNavigate?: () => void }) {
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
    <div className="flex items-center gap-2 text-muted-foreground text-sm">
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
        onClick={onNavigate}
      >
        {content}
      </Link>
    );
  }

  return <div className="px-4 py-2 border-b border-border">{content}</div>;
}

/**
 * Mobile queue sheet that slides in from the right and can be swiped to dismiss.
 * Similar to the fullscreen player swipe-to-close behavior.
 */
export function MobileQueueSheet() {
  const [isOpen, setIsOpen] = useAtom(queuePanelOpenAtom);
  const [isFullscreen, setIsFullscreen] = useAtom(fullscreenPlayerOpenAtom);
  const connection = useAtomValue(serverConnectionAtom);
  const queueState = useAtomValue(serverQueueStateAtom);
  const isQueueLoading = useAtomValue(isQueueLoadingAtom);
  const clearQueue = useSetAtom(clearQueueAtom);
  const queueDisplayRef = useRef<VirtualizedQueueDisplayHandle>(null);
  const prefsLoaded = useAtomValue(preferencesLoadedAtom);
  const currentAccountKey = connection ? accountKey(connection) : null;

  // On mobile, the queue sheet should never auto-open from persisted state.
  // Close it before paint on the first mount and whenever the active account changes.
  const prevAccountKeyRef = useRef<string | null | undefined>(undefined);
  useLayoutEffect(() => {
    if (typeof window === "undefined" || window.innerWidth >= 1280) {
      prevAccountKeyRef.current = currentAccountKey;
      return;
    }

    if (prevAccountKeyRef.current === undefined) {
      prevAccountKeyRef.current = currentAccountKey;
      if (isOpen) {
        setIsOpen(false);
      }
      return;
    }

    if (prevAccountKeyRef.current !== currentAccountKey) {
      prevAccountKeyRef.current = currentAccountKey;
      if (isOpen) {
        setIsOpen(false);
      }
    }
  }, [currentAccountKey, isOpen, setIsOpen]);

  // Also close after server preference hydration in case a stored open state
  // slips through before the mobile mount guard above runs.
  const prevPrefsLoadedRef = useRef(prefsLoaded);
  useLayoutEffect(() => {
    if (
      !prevPrefsLoadedRef.current &&
      prefsLoaded &&
      isOpen &&
      window.innerWidth < 1280
    ) {
      setIsOpen(false);
    }
    prevPrefsLoadedRef.current = prefsLoaded;
  }, [prefsLoaded, isOpen, setIsOpen]);

  // Track if we're in the middle of a gesture-based close animation
  const [isClosingViaGesture, setIsClosingViaGesture] = useState(false);
  // Track if closing animation has completed (for pointer-events)
  const [closeAnimationComplete, setCloseAnimationComplete] = useState(false);
  // Track if we're currently dragging (to control backdrop opacity source)
  const [isDragging, setIsDragging] = useState(false);

  // Motion values for swipe-to-close (horizontal)
  const dragX = useMotionValue(0);
  // Opacity fades as the view is dragged right
  const sheetOpacity = useTransform(dragX, [0, SHEET_WIDTH / 2], [1, 0.5]);
  const backdropOpacity = useTransform(dragX, [0, SHEET_WIDTH], [1, 0]);

  // Track if we've already scrolled for this open state
  const hasScrolledRef = useRef(false);

  // Reset scroll tracking when panel closes
  useEffect(() => {
    if (!isOpen) {
      hasScrolledRef.current = false;
      dragX.set(0);
    }
  }, [isOpen, dragX]);

  // Auto-scroll to current song when queue panel opens (only once per open)
  useEffect(() => {
    if (
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
  }, [isOpen, isQueueLoading, queueState]);

  // Handle Escape key to close
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setIsOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, setIsOpen]);

  // Track whether queue was closed via the back button (popstate)
  const closedViaPopstateRef = useRef(false);
  // Track whether we've pushed a history entry that needs cleanup
  const pushedHistoryRef = useRef(false);

  // Push history state when queue opens on mobile for proper back navigation.
  // When queue closes via non-back-button means (X, swipe, backdrop tap),
  // call history.back() to remove the stale entry so back navigation works.
  useEffect(() => {
    const isMobile =
      typeof window !== "undefined" &&
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent,
      );

    if (!isMobile || !isOpen) return;

    closedViaPopstateRef.current = false;
    window.history.pushState({ queuePanel: true }, "");
    pushedHistoryRef.current = true;

    const handlePopState = () => {
      if (isHistoryCleanup()) return;
      closedViaPopstateRef.current = true;
      setIsOpen(false);
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      // Clean up the pushed history entry if queue was closed by
      // something other than the back button (X, swipe, backdrop tap)
      if (pushedHistoryRef.current && !closedViaPopstateRef.current) {
        cleanUpHistoryState();
      }
      pushedHistoryRef.current = false;
    };
  }, [isOpen, setIsOpen]);

  const handleClearQueue = () => {
    const trackCount = queueState?.totalCount ?? 0;
    clearQueue();
    toast.success(`Cleared ${trackCount} tracks from queue`);
  };

  const handleJumpToNowPlaying = () => {
    queueDisplayRef.current?.scrollToNowPlaying("smooth");
  };

  // Handler for swipe-to-close gesture end
  const handleDragEnd = (
    _event: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo,
  ) => {
    setIsDragging(false);
    const { offset, velocity } = info;
    // Close if swiped right far enough or fast enough
    const shouldClose = offset.x > 100 || velocity.x > 500;

    if (shouldClose) {
      // Mark that we're closing via gesture so exit animation is skipped
      setIsClosingViaGesture(true);
      // Mark animation complete immediately to allow tap-through
      setCloseAnimationComplete(true);
      // Animate off-screen then close - use window width to ensure fully offscreen
      const targetX =
        typeof window !== "undefined" ? window.innerWidth : SHEET_WIDTH;
      const animDuration = 500; // ms
      animate(dragX, targetX, {
        type: "tween",
        duration: animDuration / 1000,
        ease: [0.32, 0.72, 0, 1],
      });
      // Schedule the close after animation completes
      // This ensures the drag gesture is fully complete before unmounting
      setTimeout(() => {
        setIsOpen(false);
        setIsClosingViaGesture(false);
        setCloseAnimationComplete(false);
        dragX.set(0);
      }, animDuration + 50); // Add buffer to ensure gesture is fully complete
    } else {
      // Snap back to origin
      animate(dragX, 0, { type: "spring", stiffness: 500, damping: 30 });
    }
  };

  const handleDragStart = () => {
    setIsDragging(true);
  };

  const shouldRender = isOpen || isClosingViaGesture;

  // Only render on mobile (when fullscreen is open and queue is requested)
  // The desktop version is handled by QueueSidebar
  if (
    !isFullscreen &&
    typeof window !== "undefined" &&
    window.innerWidth >= 1280
  ) {
    return null;
  }

  return (
    <AnimatePresence>
      {shouldRender && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={
              isClosingViaGesture
                ? { opacity: 0, transition: { duration: 0 } }
                : { opacity: 0 }
            }
            transition={{ duration: 0.3 }}
            style={{
              // Only use motion value during drag, otherwise let framer handle opacity
              opacity:
                isDragging || isClosingViaGesture ? backdropOpacity : undefined,
              // Disable pointer events during close animation and exit animation
              pointerEvents:
                closeAnimationComplete || !isOpen ? "none" : "auto",
            }}
            className="fixed inset-0 z-[60] bg-black/50"
            onClick={() => setIsOpen(false)}
          />

          {/* Sheet */}
          <motion.div
            data-queue-panel="open"
            role="dialog"
            aria-label="Queue"
            aria-modal="true"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={
              isClosingViaGesture
                ? { x: 0, opacity: 0, transition: { duration: 0 } }
                : { x: "100%" }
            }
            transition={{
              type: "tween",
              duration: 0.4,
              ease: [0.32, 0.72, 0, 1],
            }}
            style={{
              x: dragX,
              // Only apply drag-based opacity during active drag or gesture close.
              // During normal enter/exit animations, let framer-motion handle opacity
              // to avoid NaN from percentage-based initial values interacting with useTransform.
              opacity:
                isDragging || isClosingViaGesture ? sheetOpacity : undefined,
              pointerEvents:
                closeAnimationComplete || !isOpen ? "none" : "auto",
            }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={{ left: 0, right: 0.5 }}
            dragDirectionLock
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            className={cn(
              "fixed top-0 right-0 bottom-0 z-[60] w-full sm:w-[400px] bg-background border-l border-border flex flex-col",
              // Disable text selection during swipe
              "select-none",
              // Allow vertical scroll gestures to pass through, horizontal gestures control sheet
              "touch-pan-y",
              // Safe area padding for mobile status bar
              "pt-safe",
            )}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <h2 className="font-semibold flex items-center gap-2">
                <ListMusic className="w-5 h-5" />
                Queue
              </h2>
              <div className="flex items-center gap-1">
                {queueState && queueState.totalCount > 0 && !isQueueLoading && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleJumpToNowPlaying}
                      className="text-muted-foreground hover:text-foreground h-8 w-8"
                      aria-label="Jump to now playing"
                    >
                      <ListStart className="w-4 h-4" />
                    </Button>
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
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsOpen(false)}
                  className="h-8 w-8"
                  aria-label="Close queue"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <QueueSourceDisplay
              onNavigate={() => {
                setIsOpen(false);
                setIsFullscreen(false);
              }}
            />
            <VirtualizedQueueDisplay
              ref={queueDisplayRef}
              onNavigate={() => {
                // Close both the queue sheet and fullscreen player when navigating
                setIsOpen(false);
                setIsFullscreen(false);
              }}
            />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
