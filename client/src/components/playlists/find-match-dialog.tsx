"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getClient } from "@/lib/api/client";
import { TrackSearchPanel } from "./track-search-panel";
import type { Song } from "@/lib/api/types";
import type { MissingEntryDataResponse } from "@/lib/api/generated/MissingEntryDataResponse";

export interface FindMatchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playlistId: string;
  entryId: string;
  position: number;
  missing: MissingEntryDataResponse;
  /** Unique ID prefix for form element IDs to avoid conflicts */
  idPrefix?: string;
  /** Callback when a match is successfully saved */
  onMatched?: () => void;
}

export function FindMatchDialog({
  open,
  onOpenChange,
  playlistId,
  entryId,
  position,
  missing,
  idPrefix = "",
  onMatched,
}: FindMatchDialogProps) {
  const queryClient = useQueryClient();

  // Mutation for matching the entry
  const matchMutation = useMutation({
    mutationFn: async (songId: string) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      await client.matchMissingEntry(playlistId, entryId, songId);
    },
    onSuccess: () => {
      toast.success("Entry matched successfully");
      onMatched?.();
      queryClient.invalidateQueries({
        queryKey: ["playlistSongs", playlistId],
      });
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error(
        `Failed to match entry: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    },
  });

  const handleConfirm = (song: Song) => {
    matchMutation.mutate(song.id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[800px] overflow-hidden">
        <DialogHeader>
          <DialogTitle>Find matching track</DialogTitle>
        </DialogHeader>
        {open && (
          <TrackSearchPanel
            parsed={{
              title: missing.title,
              artist: missing.artist,
              album: missing.album,
              duration: missing.duration,
              raw: missing.raw,
            }}
            onConfirm={handleConfirm}
            isConfirming={matchMutation.isPending}
            idPrefix={`${idPrefix}find-match-${position}-`}
            autoSearch={true}
            showRawText={true}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
