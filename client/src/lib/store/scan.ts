import { atom } from "jotai";
import type { ScanProgressUpdate, ScanLogEntry } from "@/lib/api/types";

/**
 * Scan state for the admin library scanning UI.
 *
 * The scan progress is maintained by the useScanProgressStream hook
 * which establishes a persistent SSE connection when the user is connected.
 */

// Current scan progress (null when not scanning or no recent scan)
export const scanProgressAtom = atom<ScanProgressUpdate | null>(null);

// Scan logs
export const scanLogsAtom = atom<ScanLogEntry[]>([]);

// Whether a scan is currently in progress
export const isScanningAtom = atom((get) => {
  const progress = get(scanProgressAtom);
  return progress?.scanning ?? false;
});

// Whether the scan dialog is open
export const scanDialogOpenAtom = atom(false);

// Which folder ID to scan (null = scan all folders)
export const scanFolderIdAtom = atom<number | null>(null);

// Folder name for display in dialog (optional)
export const scanFolderNameAtom = atom<string | null>(null);
