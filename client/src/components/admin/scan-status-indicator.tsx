"use client";

import { useAtomValue, useSetAtom } from "jotai";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { isScanningAtom, scanDialogOpenAtom, scanProgressAtom } from "@/lib/store/scan";

interface ScanStatusIndicatorProps {
  collapsed?: boolean;
}

export function ScanStatusIndicator({ collapsed = false }: ScanStatusIndicatorProps) {
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

  const statusText = progressPercent !== undefined 
    ? `Scanning... ${progressPercent}%` 
    : "Scanning...";

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="w-full h-10 hover:bg-sidebar-accent"
            onClick={() => setDialogOpen(true)}
          >
            <RefreshCw className="w-5 h-5 animate-spin text-primary" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p>{statusText}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Button
      variant="ghost"
      className={cn(
        "w-full justify-start gap-4 h-10 px-3",
        "hover:bg-sidebar-accent overflow-hidden"
      )}
      onClick={() => setDialogOpen(true)}
    >
      <RefreshCw className="w-5 h-5 shrink-0 animate-spin text-primary" />
      <span className="truncate whitespace-nowrap text-sm">{statusText}</span>
    </Button>
  );
}
