"use client";

import { useEffect, useRef, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  RefreshCw,
  X,
  AlertCircle,
  CheckCircle,
  Loader2,
  FolderSearch,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import { getClient } from "@/lib/api/client";
import {
  scanProgressAtom,
  scanLogsAtom,
  scanDialogOpenAtom,
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

export function ScanDialog() {
  const [open, setOpen] = useAtom(scanDialogOpenAtom);
  const progress = useAtomValue(scanProgressAtom);
  const logs = useAtomValue(scanLogsAtom);
  const setProgress = useSetAtom(scanProgressAtom);
  const setLogs = useSetAtom(scanLogsAtom);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Local state for scan options
  const [fullScan, setFullScan] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  // Auto-scroll to bottom of logs
  useEffect(() => {
    if (logsEndRef.current && logs.length > 0) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  const handleStartScan = async () => {
    const client = getClient();
    if (!client) {
      toast.error("Not connected to server");
      return;
    }

    setIsStarting(true);
    try {
      const response = await client.startScan({
        full: fullScan,
        dryRun: dryRun,
      });

      if (response.status === "started") {
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

  const isScanning = progress?.scanning ?? false;
  const isFinished = progress?.finished ?? false;
  const hasError = progress?.error != null;

  const progressPercent =
    progress?.total && progress.total > 0
      ? Math.round((progress.scanned / progress.total) * 100)
      : undefined;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className={cn("w-5 h-5", isScanning && "animate-spin")} />
            Library Scan
          </DialogTitle>
          <DialogDescription>
            Scan your music folders for new or changed files
          </DialogDescription>
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
                    <p className="text-sm text-destructive">{progress.error}</p>
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
                    <span>{progressPercent}%</span>
                  </div>
                </div>
              )}

              {/* Stats */}
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="p-2 bg-muted/50 rounded-md">
                  <p className="text-lg font-bold text-green-600">
                    {progress.added}
                  </p>
                  <p className="text-xs text-muted-foreground">Added</p>
                </div>
                <div className="p-2 bg-muted/50 rounded-md">
                  <p className="text-lg font-bold text-blue-600">
                    {progress.updated}
                  </p>
                  <p className="text-xs text-muted-foreground">Updated</p>
                </div>
                <div className="p-2 bg-muted/50 rounded-md">
                  <p className="text-lg font-bold text-orange-600">
                    {progress.removed}
                  </p>
                  <p className="text-xs text-muted-foreground">Removed</p>
                </div>
                <div className="p-2 bg-muted/50 rounded-md">
                  <p className="text-lg font-bold text-red-600">
                    {progress.errors}
                  </p>
                  <p className="text-xs text-muted-foreground">Errors</p>
                </div>
              </div>

              {/* Current File/Folder */}
              {isScanning && (progress.currentFolder || progress.currentFile) && (
                <div className="p-3 bg-muted/30 rounded-md space-y-1">
                  {progress.currentFolder && (
                    <div className="flex items-center gap-2 text-sm">
                      <FolderSearch className="w-4 h-4 text-muted-foreground shrink-0" />
                      <span className="truncate">{progress.currentFolder}</span>
                    </div>
                  )}
                  {progress.currentFile && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <FileText className="w-3 h-3 shrink-0" />
                      <span className="truncate">{progress.currentFile}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Logs */}
              {logs.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Logs</p>
                  <ScrollArea className="h-40 rounded-md border bg-muted/20">
                    <div className="p-2 space-y-1 font-mono text-xs">
                      {logs.map((log, index) => (
                        <div
                          key={index}
                          className={cn(
                            "flex gap-2",
                            log.level === "ERROR" && "text-red-500",
                            log.level === "WARN" && "text-yellow-500"
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
            <Button variant="destructive" onClick={handleCancelScan}>
              <X className="w-4 h-4 mr-2" />
              Cancel Scan
            </Button>
          ) : isFinished ? (
            <Button
              onClick={() => {
                setProgress(null);
                setLogs([]);
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
  );
}
