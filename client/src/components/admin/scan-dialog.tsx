"use client";

import { useEffect, useRef, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  RefreshCw,
  X,
  AlertCircle,
  CheckCircle,
  Loader2,
  FolderSearch,
  FileText,
  Plus,
  Edit,
  Trash2,
  Copy,
  Minus,
  ArrowRightLeft,
} from "lucide-react";
import { toast } from "sonner";
import { getClient } from "@/lib/api/client";
import {
  scanProgressAtom,
  scanLogsAtom,
  scanDialogOpenAtom,
  scanFolderIdAtom,
  scanFolderNameAtom,
  shouldMonitorScanAtom,
} from "@/lib/store/scan";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { ScanDetails } from "@/lib/api/generated/ScanDetails";
import type { ScanDetailEntry } from "@/lib/api/generated/ScanDetailEntry";

// Virtualization constants
const ITEM_HEIGHT = 30; // Height of each file row in pixels (with error: 60)
const ITEM_WITH_ERROR_HEIGHT = 60;
const OVERSCAN = 10; // Extra items to render above/below viewport

type StatCategory =
  | "added"
  | "updated"
  | "unchanged"
  | "removed"
  | "renamed"
  | "duplicates"
  | "errors";

interface StatDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category: StatCategory | null;
  details: ScanDetails | null;
}

function StatDetailDialog({
  open,
  onOpenChange,
  category,
  details,
}: StatDetailDialogProps) {
  // Use state instead of ref to trigger re-render when element mounts
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(
    null,
  );

  const items =
    category && details ? getItemsForCategory(category, details) : [];
  const hasErrors = category === "errors";

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollElement,
    estimateSize: (index) => {
      // Use taller height for error items since they have error text
      if (hasErrors && items[index]?.error) {
        return ITEM_WITH_ERROR_HEIGHT;
      }
      return ITEM_HEIGHT;
    },
    overscan: OVERSCAN,
    // Only enable when scroll element is ready
    enabled: scrollElement !== null,
  });

  if (!category || !details) return null;

  const config = getCategoryConfig(category);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-7xl flex flex-col min-h-0 overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {config.icon}
            <span className={config.color}>{config.title}</span>
            <span className="text-muted-foreground font-normal">
              ({items.length.toLocaleString()})
            </span>
          </DialogTitle>
          <DialogDescription>
            {category === "errors"
              ? "Files that encountered errors during scanning"
              : category === "duplicates"
                ? "Files detected as duplicates in your library"
                : `Files that were ${category} during the scan`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0">
          {items.length > 0 ? (
            <div
              ref={setScrollElement}
              className="overflow-auto rounded-md border"
              style={{ height: "calc(70vh - 180px)" }}
            >
              <div
                className="relative w-full"
                style={{ height: virtualizer.getTotalSize() }}
              >
                {virtualizer.getVirtualItems().map((virtualItem) => {
                  const item = items[virtualItem.index];
                  return (
                    <div
                      key={virtualItem.index}
                      className="absolute left-0 right-0 px-2"
                      style={{
                        height: virtualItem.size,
                        transform: `translateY(${virtualItem.start}px)`,
                      }}
                    >
                      <div className="p-2 rounded-md hover:bg-muted/50 font-mono text-xs h-full flex flex-col justify-center">
                        <div className="truncate">{item.path}</div>
                        {item.error && (
                          <div className="text-red-500 mt-1 text-[10px] truncate">
                            {item.error}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-muted-foreground">
              No files in this category
            </div>
          )}
        </div>

        <div className="flex justify-end pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function getItemsForCategory(
  category: StatCategory,
  details: ScanDetails,
): ScanDetailEntry[] {
  switch (category) {
    case "added":
      return details.added;
    case "updated":
      return details.updated;
    case "unchanged":
      return details.unchanged;
    case "removed":
      return details.removed;
    case "renamed":
      return details.renamed;
    case "duplicates":
      return details.duplicates;
    case "errors":
      return details.errors;
  }
}

function getCategoryConfig(category: StatCategory) {
  const configs: Record<
    StatCategory,
    { title: string; color: string; icon: React.ReactNode }
  > = {
    added: {
      title: "Added Files",
      color: "text-green-600",
      icon: <Plus className="w-5 h-5 text-green-600" />,
    },
    updated: {
      title: "Updated Files",
      color: "text-blue-600",
      icon: <Edit className="w-5 h-5 text-blue-600" />,
    },
    unchanged: {
      title: "Unchanged Files",
      color: "text-muted-foreground",
      icon: <Minus className="w-5 h-5 text-muted-foreground" />,
    },
    removed: {
      title: "Removed Files",
      color: "text-orange-600",
      icon: <Trash2 className="w-5 h-5 text-orange-600" />,
    },
    renamed: {
      title: "Renamed Files",
      color: "text-purple-600",
      icon: <ArrowRightLeft className="w-5 h-5 text-purple-600" />,
    },
    duplicates: {
      title: "Duplicate Files",
      color: "text-yellow-600",
      icon: <Copy className="w-5 h-5 text-yellow-600" />,
    },
    errors: {
      title: "Error Files",
      color: "text-red-600",
      icon: <AlertCircle className="w-5 h-5 text-red-600" />,
    },
  };
  return configs[category];
}

interface StatBoxProps {
  count: number;
  label: string;
  colorClass: string;
  onClick?: () => void;
  disabled?: boolean;
}

function StatBox({
  count,
  label,
  colorClass,
  onClick,
  disabled,
}: StatBoxProps) {
  const isClickable = !disabled && count > 0 && onClick;

  return (
    <button
      type="button"
      className={cn(
        "p-2 bg-muted/50 rounded-md transition-colors",
        isClickable && "hover:bg-muted cursor-pointer",
        !isClickable && "cursor-default",
      )}
      onClick={isClickable ? onClick : undefined}
      disabled={!isClickable}
    >
      <p className={cn("text-lg font-bold", colorClass)}>{count}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </button>
  );
}

function formatEta(totalSecs: number): string {
  const hours = Math.floor(totalSecs / 3600);
  const minutes = Math.floor((totalSecs % 3600) / 60);
  const seconds = totalSecs % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function ScanDialog() {
  const [open, setOpen] = useAtom(scanDialogOpenAtom);
  const [folderId, setFolderId] = useAtom(scanFolderIdAtom);
  const [folderName, setFolderName] = useAtom(scanFolderNameAtom);
  const progress = useAtomValue(scanProgressAtom);
  const logs = useAtomValue(scanLogsAtom);
  const setProgress = useSetAtom(scanProgressAtom);
  const setLogs = useSetAtom(scanLogsAtom);
  const setShouldMonitor = useSetAtom(shouldMonitorScanAtom);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Local state for scan options
  const [fullScan, setFullScan] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [analyzeReplaygain, setAnalyzeReplaygain] = useState(false);
  const [analyzeBliss, setAnalyzeBliss] = useState(false);
  const [analyzeWaveform, setAnalyzeWaveform] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [blissAvailable, setBlissAvailable] = useState(true);

  // Fetch server features to know if bliss is compiled in
  useEffect(() => {
    const client = getClient();
    if (!client) return;
    client
      .getFeatures()
      .then((features) => setBlissAvailable(features.bliss))
      .catch(() => setBlissAvailable(false));
  }, []);

  // State for stat details
  const [detailCategory, setDetailCategory] = useState<StatCategory | null>(
    null,
  );
  const [scanDetails, setScanDetails] = useState<ScanDetails | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);

  // Reset folder ID when dialog closes
  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      setFolderId(null);
      setFolderName(null);
    }
  };

  // Auto-scroll to bottom of logs
  useEffect(() => {
    if (logsEndRef.current && logs.length > 0) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  // Load scan details when scan finishes
  useEffect(() => {
    if (progress?.finished && !progress.error) {
      const loadDetails = async () => {
        const client = getClient();
        if (!client) return;
        try {
          const details = await client.getScanDetails();
          setScanDetails(details);
        } catch (error) {
          console.error("Failed to load scan details:", error);
        }
      };
      loadDetails();
    }
  }, [progress?.finished, progress?.error]);

  const handleStartScan = async () => {
    const client = getClient();
    if (!client) {
      toast.error("Not connected to server");
      return;
    }

    setIsStarting(true);
    // Clear cached details when starting a new scan
    setScanDetails(null);
    try {
      const response = await client.startScan({
        full: fullScan,
        dryRun: dryRun,
        analyzeReplaygain: analyzeReplaygain,
        analyzeBliss: analyzeBliss,
        analyzeWaveform: analyzeWaveform,
        folderId: folderId ?? undefined,
      });

      if (response.status === "started") {
        // Enable SSE monitoring for scan progress
        setShouldMonitor(true);
        toast.success("Scan started", {
          description: response.message,
        });
      }
    } catch (error) {
      toast.error("Failed to start scan", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsStarting(false);
    }
  };

  const handleCancelScan = async () => {
    const client = getClient();
    if (!client) return;

    try {
      await client.cancelScan();
      toast.info("Cancellation requested", {
        description: "The scan will stop after the current file",
      });
    } catch (error) {
      toast.error("Failed to cancel scan", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  const handleStatClick = async (category: StatCategory) => {
    // Always fetch fresh details from the server to get the latest state
    setIsLoadingDetails(true);
    const client = getClient();
    if (!client) {
      setIsLoadingDetails(false);
      return;
    }

    try {
      const details = await client.getScanDetails();
      setScanDetails(details);
      setDetailCategory(category);
    } catch (error) {
      console.error("Failed to load scan details:", error);
      toast.error("Failed to load scan details");
    } finally {
      setIsLoadingDetails(false);
    }
  };

  const isScanning = progress?.scanning ?? false;
  const isFinished = progress?.finished ?? false;
  const hasError = progress?.error != null;

  const progressPercent =
    progress?.total && progress.total > 0
      ? Math.round((progress.scanned / progress.total) * 100)
      : undefined;

  const dialogTitle = folderName ? `Scan "${folderName}"` : "Library Scan";
  const dialogDescription = folderName
    ? `Scan the "${folderName}" folder for new or changed files`
    : "Scan your music folders for new or changed files";

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-6xl flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw
                className={cn("w-5 h-5", isScanning && "animate-spin")}
              />
              {dialogTitle}
            </DialogTitle>
            <DialogDescription>{dialogDescription}</DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 space-y-4">
            {/* Scan Options - only show when not scanning */}
            {!isScanning && !isFinished && (
              <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="full-scan">Full Rescan</Label>
                    <p className="text-xs text-muted-foreground">
                      Rescan all files even if unchanged
                    </p>
                  </div>
                  <Switch
                    id="full-scan"
                    checked={fullScan}
                    onCheckedChange={setFullScan}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="dry-run">Dry Run</Label>
                    <p className="text-xs text-muted-foreground">
                      Preview changes without modifying the database
                    </p>
                  </div>
                  <Switch
                    id="dry-run"
                    checked={dryRun}
                    onCheckedChange={setDryRun}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="analyze-replaygain">
                      Analyze ReplayGain
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Compute loudness values using EBU R128 analysis (slower)
                    </p>
                  </div>
                  <Switch
                    id="analyze-replaygain"
                    checked={analyzeReplaygain}
                    onCheckedChange={setAnalyzeReplaygain}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label
                      htmlFor="analyze-bliss"
                      className={cn(!blissAvailable && "text-muted-foreground")}
                    >
                      Analyze Song Similarity
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {blissAvailable
                        ? "Compute audio features for song radio (slower)"
                        : "Not available — server compiled without bliss feature"}
                    </p>
                  </div>
                  <Switch
                    id="analyze-bliss"
                    checked={analyzeBliss}
                    onCheckedChange={setAnalyzeBliss}
                    disabled={!blissAvailable}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="analyze-waveform">Analyze Waveforms</Label>
                    <p className="text-xs text-muted-foreground">
                      Pre-compute waveform data for visualization (shared decode
                      with ReplayGain)
                    </p>
                  </div>
                  <Switch
                    id="analyze-waveform"
                    checked={analyzeWaveform}
                    onCheckedChange={setAnalyzeWaveform}
                  />
                </div>
              </div>
            )}

            {/* Progress Section */}
            {(isScanning || isFinished) && progress && (
              <div className="space-y-4">
                {/* Status Header */}
                <div className="flex items-center gap-3">
                  {isScanning && (
                    <Loader2 className="w-5 h-5 animate-spin text-primary" />
                  )}
                  {isFinished && !hasError && (
                    <CheckCircle className="w-5 h-5 text-green-500" />
                  )}
                  {isFinished && hasError && (
                    <AlertCircle className="w-5 h-5 text-destructive" />
                  )}
                  <div className="flex-1">
                    <p className="font-medium">
                      {isScanning
                        ? `Scanning... (${progress.mode})`
                        : hasError
                          ? "Scan Failed"
                          : "Scan Complete"}
                    </p>
                    {hasError && (
                      <p className="text-sm text-destructive">
                        {progress.error}
                      </p>
                    )}
                  </div>
                </div>

                {/* Progress Bar */}
                {progressPercent !== undefined && (
                  <div className="space-y-2">
                    <Progress value={progressPercent} className="h-2" />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>
                        {progress.scanned} / {progress.total} files
                      </span>
                      <div className="flex gap-3">
                        {isScanning &&
                          progress.etaSeconds != null &&
                          progress.etaSeconds > 0 && (
                            <span>ETA: {formatEta(progress.etaSeconds)}</span>
                          )}
                        <span>{progressPercent}%</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Stats - clickable during and after scan */}
                <div className="grid grid-cols-4 sm:grid-cols-7 gap-2 text-center">
                  <StatBox
                    count={progress.added}
                    label="Added"
                    colorClass="text-green-600"
                    onClick={() => handleStatClick("added")}
                    disabled={isLoadingDetails}
                  />
                  <StatBox
                    count={progress.updated}
                    label="Updated"
                    colorClass="text-blue-600"
                    onClick={() => handleStatClick("updated")}
                    disabled={isLoadingDetails}
                  />
                  <StatBox
                    count={progress.unchanged}
                    label="Unchanged"
                    colorClass="text-muted-foreground"
                    onClick={() => handleStatClick("unchanged")}
                    disabled={isLoadingDetails}
                  />
                  <StatBox
                    count={progress.removed}
                    label="Removed"
                    colorClass="text-orange-600"
                    onClick={() => handleStatClick("removed")}
                    disabled={isLoadingDetails}
                  />
                  <StatBox
                    count={progress.renamed}
                    label="Renamed"
                    colorClass="text-purple-600"
                    onClick={() => handleStatClick("renamed")}
                    disabled={isLoadingDetails}
                  />
                  <StatBox
                    count={progress.duplicates}
                    label="Duplicates"
                    colorClass="text-yellow-600"
                    onClick={() => handleStatClick("duplicates")}
                    disabled={isLoadingDetails}
                  />
                  <StatBox
                    count={progress.errors}
                    label="Errors"
                    colorClass="text-red-600"
                    onClick={() => handleStatClick("errors")}
                    disabled={isLoadingDetails}
                  />
                </div>

                {(isScanning || isFinished) && (
                  <p className="text-xs text-muted-foreground text-center">
                    Click on a stat to view details
                  </p>
                )}

                {/* Current File/Folder */}
                {isScanning &&
                  (progress.currentFolder || progress.currentFile) && (
                    <div className="p-3 bg-muted/30 rounded-md space-y-1">
                      {progress.currentFolder && (
                        <div className="flex items-center gap-2 text-sm">
                          <FolderSearch className="w-4 h-4 text-muted-foreground shrink-0" />
                          <span className="truncate">
                            {progress.currentFolder}
                          </span>
                        </div>
                      )}
                      {progress.currentFile && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <FileText className="w-3 h-3 shrink-0" />
                          <span className="truncate">
                            {progress.currentFile}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                {/* Logs */}
                {logs.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Logs</p>
                    <ScrollArea className="h-80 rounded-md border bg-muted/20">
                      <div className="p-2 space-y-1 font-mono text-xs">
                        {logs.map((log, index) => (
                          <div
                            key={index}
                            className={cn(
                              "flex gap-2",
                              log.level === "ERROR" && "text-red-500",
                              log.level === "WARN" && "text-yellow-500",
                            )}
                          >
                            <span className="text-muted-foreground shrink-0">
                              {log.timestamp}
                            </span>
                            <span className="shrink-0 w-12">[{log.level}]</span>
                            <span className="break-all">{log.message}</span>
                          </div>
                        ))}
                        <div ref={logsEndRef} />
                      </div>
                    </ScrollArea>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            {!isScanning && (
              <Button variant="outline" onClick={() => setOpen(false)}>
                Close
              </Button>
            )}
            {isScanning ? (
              <>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Close
                </Button>
                <Button variant="destructive" onClick={handleCancelScan}>
                  <X className="w-4 h-4 mr-2" />
                  Cancel Scan
                </Button>
              </>
            ) : isFinished ? (
              <Button
                onClick={() => {
                  setProgress(null);
                  setLogs([]);
                  setScanDetails(null);
                }}
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                New Scan
              </Button>
            ) : (
              <Button onClick={handleStartScan} disabled={isStarting}>
                {isStarting ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4 mr-2" />
                )}
                {isStarting ? "Starting..." : "Start Scan"}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Stat Details Dialog */}
      <StatDetailDialog
        open={detailCategory !== null}
        onOpenChange={(open) => !open && setDetailCategory(null)}
        category={detailCategory}
        details={scanDetails}
      />
    </>
  );
}
