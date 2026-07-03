"use client";

import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ChevronRight,
  Download,
  Pause,
  Play,
  Trash2,
  Wifi,
  HardDrive,
  Music2,
} from "lucide-react";
import { useAtom, useAtomValue } from "jotai";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  downloadFormatAtom,
  downloadBitrateAtom,
  downloadWifiOnlyAtom,
  downloadStateMapAtom,
  downloadsPausedAtom,
  type DownloadFormat,
} from "@/lib/store/downloads";
import { useDownloadActions } from "@/lib/hooks/use-download-actions";
import { isTauriMobile } from "@/lib/tauri";
import { formatFileSize } from "@/lib/utils/format";
import { toast } from "sonner";
import { hapticDestructive, hapticSelection } from "@/lib/utils/haptic";

/**
 * Downloads settings card. Only renders on mobile (Tauri Android app); on
 * desktop the entire card is hidden because offline downloads aren't a
 * concept there.
 *
 * Surfaces:
 *  - Download format (Opus transcoded / Original file)
 *  - Download bitrate (only when format is Opus)
 *  - Wi-Fi only toggle
 *  - Pause / resume all downloads
 *  - Storage usage summary (count of items + total bytes)
 *  - Clear all downloads (with confirm dialog)
 */
export function DownloadsSettingsCard() {
  if (!isTauriMobile()) return null;
  return (
    <motion.div
      id="settings-downloads"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.32 }}
      className="scroll-mt-32"
    >
      <DownloadsCardInner />
    </motion.div>
  );
}

function DownloadsCardInner() {
  const [format, setFormat] = useAtom(downloadFormatAtom);
  const [bitrate, setBitrate] = useAtom(downloadBitrateAtom);
  const [wifiOnly, setWifiOnly] = useAtom(downloadWifiOnlyAtom);
  const stateMap = useAtomValue(downloadStateMapAtom);
  const paused = useAtomValue(downloadsPausedAtom);
  const { pauseAllDownloads, resumeAllDownloads, clearAllDownloads } =
    useDownloadActions();
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  // Aggregate stats for the storage summary.
  let totalBytes = 0;
  let downloadedCount = 0;
  let activeCount = 0;
  for (const state of stateMap.values()) {
    totalBytes += state.bytesDownloaded;
    if (state.status === "completed") downloadedCount++;
    if (state.status === "downloading" || state.status === "queued")
      activeCount++;
  }

  const handleClearAll = async () => {
    setConfirmClearOpen(false);
    await clearAllDownloads();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Download className="w-5 h-5" />
          Offline Downloads
        </CardTitle>
        <CardDescription>
          Configure how music is downloaded for offline playback
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Download Format */}
        <div className="space-y-2">
          <label className="flex items-center gap-2 font-medium">
            <Music2 className="w-4 h-4" />
            Download Format
          </label>
          <p className="text-xs text-muted-foreground">
            Opus transcodes are smaller and ideal for offline use. Original
            preserves source quality but uses more storage.
          </p>
          <Select
            value={format}
            onValueChange={(v: string) => {
              hapticSelection();
              setFormat(v as DownloadFormat);
              toast.success(
                v === "opus"
                  ? "Downloads will transcode to Opus"
                  : "Downloads will use the original file",
              );
            }}
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="opus">Opus (transcoded)</SelectItem>
              <SelectItem value="original">Original (no transcode)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Bitrate - only for Opus */}
        {format === "opus" && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 font-medium">
              <Download className="w-4 h-4" />
              Download Bitrate
            </label>
            <p className="text-xs text-muted-foreground">
              Lower bitrates use less storage at the cost of audio quality.
            </p>
            <Select
              value={String(bitrate)}
              onValueChange={(v) => {
                hapticSelection();
                setBitrate(Number(v));
              }}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="64">64 kbps</SelectItem>
                <SelectItem value="96">96 kbps</SelectItem>
                <SelectItem value="128">128 kbps</SelectItem>
                <SelectItem value="160">160 kbps</SelectItem>
                <SelectItem value="192">192 kbps</SelectItem>
                <SelectItem value="256">256 kbps</SelectItem>
                <SelectItem value="320">320 kbps</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        <Separator />

        {/* Wi-Fi only */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <label className="flex items-center gap-2 font-medium">
              <Wifi className="w-4 h-4" />
              Download over Wi-Fi only
            </label>
            <p className="text-xs text-muted-foreground">
              Pause downloads on metered connections to save mobile data.
            </p>
          </div>
          <Switch
            checked={wifiOnly}
            onCheckedChange={(v) => {
              hapticSelection();
              setWifiOnly(v);
            }}
          />
        </div>

        <Separator />

        {/* Pause / resume + storage summary */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <label className="flex items-center gap-2 font-medium">
              <Pause className="w-4 h-4" />
              Download Queue
            </label>
            <p className="text-xs text-muted-foreground">
              {activeCount > 0
                ? `${activeCount} download${activeCount === 1 ? "" : "s"} in progress`
                : paused
                  ? "Downloads paused"
                  : "No active downloads"}
            </p>
          </div>
          {paused ? (
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                hapticSelection();
                await resumeAllDownloads();
                toast.success("Downloads resumed");
              }}
            >
              <Play className="w-4 h-4 mr-1.5" />
              Resume
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={activeCount === 0}
              onClick={async () => {
                hapticSelection();
                await pauseAllDownloads();
                toast.success("Downloads paused");
              }}
            >
              <Pause className="w-4 h-4 mr-1.5" />
              Pause
            </Button>
          )}
        </div>

        <Link
          to="/settings/downloads"
          className="flex items-center justify-between gap-4 rounded-lg -mx-2 px-2 py-2 transition-colors hover:bg-muted/50 active:bg-muted/70"
          onClick={() => hapticSelection()}
        >
          <div className="space-y-1 min-w-0">
            <label className="flex items-center gap-2 font-medium">
              <HardDrive className="w-4 h-4" />
              Storage
            </label>
            <p className="text-xs text-muted-foreground">
              {downloadedCount > 0
                ? `${downloadedCount} song${downloadedCount === 1 ? "" : "s"} downloaded`
                : "No downloads yet"}
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground tabular-nums">
            <span>{formatFileSize(totalBytes)}</span>
            <ChevronRight className="w-4 h-4" />
          </div>
        </Link>

        <Separator />

        {/* Clear all */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <label className="flex items-center gap-2 font-medium">
              <Trash2 className="w-4 h-4" />
              Remove All Downloads
            </label>
            <p className="text-xs text-muted-foreground">
              Frees up all storage used by offline music on this device.
            </p>
          </div>
          <Button
            variant="destructive"
            size="sm"
            disabled={downloadedCount === 0 && activeCount === 0}
            onClick={() => {
              hapticDestructive();
              setConfirmClearOpen(true);
            }}
          >
            <Trash2 className="w-4 h-4 mr-1.5" />
            Clear all
          </Button>
        </div>
      </CardContent>

      <AlertDialog open={confirmClearOpen} onOpenChange={setConfirmClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove all downloads?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes every downloaded song from your device. You
              won&apos;t be able to play songs offline until you re-download
              them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClearAll}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/80"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Remove all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
