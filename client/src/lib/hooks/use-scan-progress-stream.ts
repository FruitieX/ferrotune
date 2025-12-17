"use client";

import { useEffect, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getClient } from "@/lib/api/client";
import { scanProgressAtom, scanLogsAtom } from "@/lib/store/scan";
import { isClientInitializedAtom } from "@/lib/store/auth";
import type { ScanProgressUpdate } from "@/lib/api/types";

/**
 * Hook to maintain a persistent SSE connection for scan progress updates.
 * This should be used in a top-level component to keep the scan state in sync
 * even when the scan dialog is closed.
 */
export function useScanProgressStream() {
  // We need to wait for the client to be initialized, not just connected
  // This ensures getClient() returns a valid instance
  const isClientInitialized = useAtomValue(isClientInitializedAtom);
  const setProgress = useSetAtom(scanProgressAtom);
  const setLogs = useSetAtom(scanLogsAtom);
  const queryClient = useQueryClient();
  const eventSourceRef = useRef<EventSource | null>(null);
  const wasScanning = useRef(false);
  const hasShownCompletionToast = useRef(false);

  useEffect(() => {
    if (!isClientInitialized) return;

    const client = getClient();
    if (!client) return;

    // Fetch initial status
    client
      .getFullScanStatus()
      .then((status) => {
        setProgress({
          scanning: status.scanning,
          scanned: status.scanned,
          total: status.total,
          added: status.added,
          updated: status.updated,
          unchanged: status.unchanged,
          removed: status.removed,
          errors: status.errors,
          renamed: status.renamed,
          duplicates: status.duplicates,
          currentFolder: status.currentFolder,
          currentFile: status.currentFile,
          mode: status.mode,
          finished: status.finished,
          error: status.error,
          logs: status.logs,
        });
        setLogs(status.logs);

        if (status.scanning) {
          wasScanning.current = true;
        }
      })
      .catch(() => {
        // Silently ignore errors fetching initial status
      });

    const connectToStream = () => {
      const streamUrl = client.getScanProgressStreamUrl();
      const eventSource = new EventSource(streamUrl);
      eventSourceRef.current = eventSource;

      eventSource.onmessage = (event) => {
        try {
          const update: ScanProgressUpdate = JSON.parse(event.data);
          setProgress(update);

          // Handle logs from SSE updates
          // After first update, logs come incrementally so we append
          // The first update from SSE contains all logs (not incremental)
          // so we check if we already have logs before appending
          if (update.logs && update.logs.length > 0) {
            setLogs((prev) => {
              // Check if these logs would be duplicates (first SSE message has all logs)
              if (prev.length > 0 && update.logs.length > 0) {
                // Check if the first new log is already in our list (duplicate)
                const lastPrevTimestamp = prev[prev.length - 1]?.timestamp;
                const firstNewTimestamp = update.logs[0]?.timestamp;
                if (
                  lastPrevTimestamp &&
                  firstNewTimestamp &&
                  firstNewTimestamp <= lastPrevTimestamp
                ) {
                  // These are duplicate/old logs, replace entirely
                  return update.logs;
                }
              }
              // Append new logs
              return [...prev, ...update.logs];
            });
          }

          // Track if we were scanning
          if (update.scanning && !update.finished) {
            wasScanning.current = true;
            hasShownCompletionToast.current = false;
          }

          // Show notification when scan completes
          if (
            update.finished &&
            wasScanning.current &&
            !hasShownCompletionToast.current
          ) {
            hasShownCompletionToast.current = true;

            if (update.error) {
              toast.error("Library scan failed", {
                description: update.error,
              });
            } else if (update.errors > 0) {
              toast.warning("Library scan complete with errors", {
                description: `Added ${update.added}, updated ${update.updated}, removed ${update.removed}. ${update.errors} errors occurred.`,
              });
            } else {
              toast.success("Library scan complete", {
                description: `Added ${update.added}, updated ${update.updated}, removed ${update.removed}.`,
              });
            }

            // Invalidate relevant queries to refresh the UI
            queryClient.invalidateQueries({ queryKey: ["serverStats"] });
            queryClient.invalidateQueries({ queryKey: ["artists"] });
            queryClient.invalidateQueries({ queryKey: ["albums"] });
            queryClient.invalidateQueries({ queryKey: ["songs"] });
            queryClient.invalidateQueries({ queryKey: ["genres"] });
            queryClient.invalidateQueries({ queryKey: ["playlists"] });

            wasScanning.current = false;
          }
        } catch {
          // Ignore parse errors (keep-alive messages)
        }
      };

      eventSource.onerror = () => {
        // Connection error - close and reconnect after delay
        eventSource.close();
        eventSourceRef.current = null;

        // Reconnect after 5 seconds
        setTimeout(() => {
          if (isClientInitialized) {
            connectToStream();
          }
        }, 5000);
      };
    };

    connectToStream();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [isClientInitialized, setProgress, setLogs, queryClient]);
}
