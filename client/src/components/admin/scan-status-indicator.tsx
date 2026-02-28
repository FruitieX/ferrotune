"use client";

import { useAtomValue, useSetAtom } from "jotai";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  isScanningAtom,
  scanDialogOpenAtom,
  scanProgressAtom,
} from "@/lib/store/scan";
function formatEtaShort(totalSecs: number): string {
  const hours = Math.floor(totalSecs / 3600);
  const minutes = Math.floor((totalSecs % 3600) / 60);
  const seconds = totalSecs % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
interface ScanStatusIndicatorProps {
  /** Whether the sidebar is collapsed (affects tooltip position) */
  collapsed?: boolean;
}

/**
 * Shows a spinning scan icon in the sidebar header when scanning is in progress.
 * Always renders as an icon-only button with a tooltip showing scan progress.
 */
export function ScanStatusIndicator({
  collapsed = false,
}: ScanStatusIndicatorProps) {
  const isScanning = useAtomValue(isScanningAtom);
  const progress = useAtomValue(scanProgressAtom);
  const setDialogOpen = useSetAtom(scanDialogOpenAtom);

  // Don't show anything if not scanning
  if (!isScanning) {
    return null;
  }

  const progressPercent =
    progress?.total && progress.total > 0
      ? Math.round((progress.scanned / progress.total) * 100)
      : undefined;

  const statusText =
    progressPercent !== undefined
      ? `Scanning... ${progressPercent}%`
      : "Scanning...";

  const etaText =
    progress?.etaSeconds != null && progress.etaSeconds > 0
      ? formatEtaShort(progress.etaSeconds)
      : undefined;

  // Always use icon-only button with tooltip to avoid text overflow issues
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 shrink-0 hover:bg-sidebar-accent"
          onClick={() => setDialogOpen(true)}
        >
          <RefreshCw className="w-5 h-5 animate-spin text-primary" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side={collapsed ? "right" : "bottom"}>
        <p>{statusText}</p>
        {etaText && (
          <p className="text-xs text-muted-foreground">ETA: {etaText}</p>
        )}
        <p className="text-xs text-muted-foreground">Click to view details</p>
      </TooltipContent>
    </Tooltip>
  );
}
