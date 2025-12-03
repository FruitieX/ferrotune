"use client";

import { ReactNode } from "react";
import { Play, Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ActionBarProps {
  /** Handler for play all button */
  onPlayAll?: () => void;
  /** Handler for shuffle button */
  onShuffle?: () => void;
  /** Whether play buttons are disabled */
  disablePlay?: boolean;
  /** Additional action buttons (e.g., clear history, edit playlist) */
  actions?: ReactNode;
  /** Toolbar content (e.g., SongListToolbar) */
  toolbar?: ReactNode;
  /** Additional classes */
  className?: string;
  children?: ReactNode;
}

export function ActionBar({
  onPlayAll,
  onShuffle,
  disablePlay = false,
  actions,
  toolbar,
  className,
  children,
}: ActionBarProps) {
  return (
    <div className={cn(
      "sticky top-0 z-20 bg-background/80 backdrop-blur-lg border-b border-border",
      className
    )}>
      <div className="flex items-center gap-4 px-4 lg:px-6 py-4">
        {onPlayAll && (
          <Button
            size="lg"
            className="rounded-full gap-2 px-8"
            onClick={onPlayAll}
            disabled={disablePlay}
          >
            <Play className="w-5 h-5 ml-0.5" />
            Play
          </Button>
        )}
        {onShuffle && (
          <Button
            variant="outline"
            size="lg"
            className="rounded-full gap-2"
            onClick={onShuffle}
            disabled={disablePlay}
          >
            <Shuffle className="w-5 h-5" />
            Shuffle
          </Button>
        )}
        
        {/* Additional actions */}
        {actions}
        
        {/* Spacer */}
        <div className="flex-1" />
        
        {/* Toolbar (filter, sort, columns, view mode) */}
        {toolbar}
        
        {children}
      </div>
    </div>
  );
}
