"use client";

import { ReactNode } from "react";
import { Play, Shuffle, MoreHorizontal, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface ActionBarProps {
  /** Handler for play all button */
  onPlayAll?: () => void;
  /** Handler for shuffle button */
  onShuffle?: () => void;
  /** Whether play buttons are disabled */
  disablePlay?: boolean;
  /** Additional action buttons (e.g., clear history, edit playlist) - shown on desktop */
  actions?: ReactNode;
  /** Toolbar content (e.g., SongListToolbar) - shown on desktop */
  toolbar?: ReactNode;
  /** Additional classes */
  className?: string;
  children?: ReactNode;
  /** Content for mobile overflow menu - if provided, shows a mobile-only overflow button */
  mobileMenuContent?: ReactNode;
  /** Filter input that should be visible on mobile (when toolbar is hidden) */
  mobileFilter?: ReactNode;
  /** Whether to show the shuffle button on mobile when compact layout is active (default: false) */
  showShuffleOnMobile?: boolean;
  /** Whether to use compact mobile layout (hide toolbar/actions on mobile). Auto-enabled when mobileMenuContent is provided. */
  compactMobile?: boolean;
  /** Actions always visible on both mobile and desktop (e.g., entity context menu) */
  alwaysVisibleChildren?: ReactNode;
}

export function ActionBar({
  onPlayAll,
  onShuffle,
  disablePlay = false,
  actions,
  toolbar,
  className,
  children,
  mobileMenuContent,
  mobileFilter,
  showShuffleOnMobile = false,
  compactMobile: compactMobileProp = false,
  alwaysVisibleChildren,
}: ActionBarProps) {
  const compactMobile = !!mobileMenuContent || compactMobileProp;
  return (
    <div
      className={cn(
        "sticky top-0 z-20 bg-background/80 backdrop-blur-lg border-b border-border",
        className,
      )}
    >
      <div className="flex items-center gap-4 px-4 lg:px-6 py-4">
        {/* Play button - icon only on mobile, with text on desktop */}
        {onPlayAll && (
          <Button
            size="lg"
            className="rounded-full gap-2 md:px-8"
            onClick={onPlayAll}
            disabled={disablePlay}
          >
            <Play className="w-5 h-5 ml-0.5" />
            <span className="hidden md:inline">Play</span>
          </Button>
        )}
        {/* Shuffle button - hidden on mobile in compact layout (unless showShuffleOnMobile) */}
        {onShuffle && (
          <Button
            variant="outline"
            size="lg"
            className={cn(
              "rounded-full gap-2",
              compactMobile && !showShuffleOnMobile && "hidden md:inline-flex",
            )}
            onClick={onShuffle}
            disabled={disablePlay}
          >
            <Shuffle className="w-5 h-5" />
            <span className="hidden md:inline">Shuffle</span>
          </Button>
        )}

        {/* Additional actions - hidden on mobile in compact layout */}
        {actions && (
          <div className={cn(compactMobile && "hidden md:flex")}>{actions}</div>
        )}

        {/* Spacer - hidden on mobile in compact layout (filter takes over) */}
        <div className={cn("flex-1", compactMobile && "hidden md:block")} />

        {/* Toolbar (filter, sort, columns, view mode) - hidden on mobile in compact layout */}
        {toolbar && (
          <div className={cn(compactMobile && "hidden md:flex")}>{toolbar}</div>
        )}

        {/* Desktop children (typically a More dropdown) */}
        {children && (
          <div
            className={cn(
              "flex items-center",
              compactMobile && "hidden md:flex",
            )}
          >
            {children}
          </div>
        )}

        {/* Mobile filter (visible when compact layout hides the toolbar) */}
        {mobileFilter && compactMobile && (
          <div className="md:hidden flex-1 min-w-0">{mobileFilter}</div>
        )}

        {/* Mobile overflow menu */}
        {mobileMenuContent && (
          <div className="md:hidden">{mobileMenuContent}</div>
        )}

        {/* Always-visible actions (both mobile and desktop) */}
        {alwaysVisibleChildren && (
          <div className="flex items-center">{alwaysVisibleChildren}</div>
        )}
      </div>
    </div>
  );
}

// Re-export for use in mobile menus
export { MoreHorizontal, Shuffle, Check };
export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
  DropdownMenuCheckboxItem,
};
