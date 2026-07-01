"use client";

import { CheckCircle2, Download, Loader2, XCircle, Pause } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDownloadState } from "@/lib/store/downloads";
import { isTauriMobile } from "@/lib/tauri";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface OfflineStatusIconProps {
  songId: string;
  className?: string;
  /** Compact size variant for inline use in song rows. */
  compact?: boolean;
}

/**
 * Renders a small download-state indicator for a song row / card.
 *
 * - `completed`: a muted check (downloaded for offline use)
 * - `downloading`: a spinner (with optional percentage if known)
 * - `queued` / `paused`: a download-arrow with subtle styling
 * - `failed`: a small red error mark with the failure reason on hover
 * - `none` / desktop: renders nothing
 *
 * `compact` reduces icon size to ~3.5 (used inside dense song row right
 * columns where the favourite button also lives).
 */
export function OfflineStatusIcon({
  songId,
  className,
  compact = true,
}: OfflineStatusIconProps) {
  if (!isTauriMobile()) return null;
  return (
    <OfflineStatusIconInner
      songId={songId}
      className={className}
      compact={compact}
    />
  );
}

function OfflineStatusIconInner({
  songId,
  className,
  compact,
}: OfflineStatusIconProps & { compact: boolean }) {
  const state = useDownloadState(songId);
  if (state.status === "none") return null;

  const iconSize = compact ? "w-3.5 h-3.5" : "w-4 h-4";

  let tooltip: string;
  let content: React.ReactNode;

  switch (state.status) {
    case "completed":
      tooltip = "Downloaded for offline use";
      content = <CheckCircle2 className={cn(iconSize, "text-emerald-500")} />;
      break;
    case "downloading": {
      tooltip =
        state.percent >= 0 ? `Downloading (${state.percent}%)` : "Downloading…";
      content = (
        <Loader2 className={cn(iconSize, "animate-spin text-primary")} />
      );
      break;
    }
    case "queued":
      tooltip = "Queued for download";
      content = <Download className={cn(iconSize, "text-muted-foreground")} />;
      break;
    case "paused":
      tooltip = "Download paused";
      content = <Pause className={cn(iconSize, "text-muted-foreground")} />;
      break;
    case "failed":
      tooltip = state.failureReason
        ? `Download failed: ${state.failureReason}`
        : "Download failed";
      content = <XCircle className={cn(iconSize, "text-destructive")} />;
      break;
    case "removing":
      tooltip = "Removing download…";
      content = (
        <Loader2
          className={cn(iconSize, "animate-spin text-muted-foreground")}
        />
      );
      break;
    default:
      return null;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "relative inline-flex items-center justify-center shrink-0",
            className,
          )}
        >
          {content}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p>{tooltip}</p>
      </TooltipContent>
    </Tooltip>
  );
}
