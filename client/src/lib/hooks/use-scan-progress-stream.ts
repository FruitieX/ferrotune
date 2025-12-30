"use client";

import { useEffect, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getClient } from "@/lib/api/client";
import {
  scanProgressAtom,
  scanLogsAtom,
  shouldMonitorScanAtom,
} from "@/lib/store/scan";
import { isClientInitializedAtom } from "@/lib/store/auth";
import type { ScanProgressUpdate } from "@/lib/api/types";

/**
 * Hook to maintain an SSE connection for scan progress updates.
 *
 * The connection is only established when:
 * 1. Initial status check shows a scan is in progress
 * 2. User explicitly starts a scan (shouldMonitorScanAtom is set to true)
 *
 * The connection is closed when the scan completes.
 */
export function useScanProgressStream() {
  const isClientInitialized = useAtomValue(isClientInitializedAtom);
  const shouldMonitor = useAtomValue(shouldMonitorScanAtom);
  const setProgress = useSetAtom(scanProgressAtom);
  const setLogs = useSetAtom(scanLogsAtom);
  const setShouldMonitor = useSetAtom(shouldMonitorScanAtom);
  const queryClient = useQueryClient();
  const eventSourceRef = useRef<EventSource | null>(null);
  const wasScanning = useRef(false);
  const hasShownCompletionToast = useRef(false);
  const hasCheckedInitialStatus = useRef(false);

  // Effect 1: Check initial scan status on load (once)
  useEffect(() => {
    if (!isClientInitialized || hasCheckedInitialStatus.current) return;

    const client = getClient();
    if (!client) return;

    hasCheckedInitialStatus.current = true;

    // Fetch initial status to see if a scan is already in progress
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

        // If a scan is in progress, start monitoring
        if (status.scanning) {
          wasScanning.current = true;
          setShouldMonitor(true);
        }
      })
      .catch(() => {
        // Silently ignore errors fetching initial status
      });
  }, [isClientInitialized, setProgress, setLogs, setShouldMonitor]);

  // Effect 2: Manage SSE connection based on shouldMonitor
  useEffect(() => {
    if (!isClientInitialized || !shouldMonitor) {
      // Close any existing connection if we shouldn't monitor
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      return;
    }

    const client = getClient();
    if (!client) return;

    const connectToStream = () => {
      const streamUrl = client.getScanProgressStreamUrl();
      const eventSource = new EventSource(streamUrl);
      eventSourceRef.current = eventSource;

      eventSource.onmessage = (event) => {
        try {
          const update: ScanProgressUpdate = JSON.parse(event.data);
          setProgress(update);

          // Handle logs from SSE updates
          if (update.logs && update.logs.length > 0) {
            setLogs((prev) => {
              // Check if these logs would be duplicates
              if (prev.length > 0 && update.logs.length > 0) {
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

          // Handle scan completion
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

            // Stop monitoring since scan is complete
            setShouldMonitor(false);
          }
        } catch {
          // Ignore parse errors (keep-alive messages)
        }
      };

      eventSource.onerror = () => {
        // Connection error - close and reconnect after delay
        eventSource.close();
        eventSourceRef.current = null;

        // Only reconnect if we should still be monitoring
        setTimeout(() => {
          if (shouldMonitor && isClientInitialized) {
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
  }, [
    isClientInitialized,
    shouldMonitor,
    setProgress,
    setLogs,
    setShouldMonitor,
    queryClient,
  ]);
}
