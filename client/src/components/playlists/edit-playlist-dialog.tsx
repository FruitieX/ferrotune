"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getClient } from "@/lib/api/client";

interface EditPlaylistDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playlist: {
    id: string;
    name: string;
    comment?: string;
  } | null;
}

export function EditPlaylistDialog({
  open,
  onOpenChange,
  playlist,
}: EditPlaylistDialogProps) {
  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const [prevPlaylistId, setPrevPlaylistId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Update form when playlist changes (React-recommended pattern for adjusting state when props change)
  if (playlist && playlist.id !== prevPlaylistId) {
    setPrevPlaylistId(playlist.id);
    setName(playlist.name);
    setComment(playlist.comment ?? "");
  }

  const updatePlaylist = useMutation({
    mutationFn: async ({
      name,
      comment,
    }: {
      name: string;
      comment: string;
    }) => {
      const client = getClient();
      if (!client || !playlist) throw new Error("Not connected");
      return client.updatePlaylist({
        playlistId: playlist.id,
        name,
        comment: comment || undefined,
      });
    },
    onSuccess: () => {
      toast.success(`Playlist updated successfully`);
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      queryClient.invalidateQueries({
        queryKey: ["playlistSongs", playlist?.id],
      });
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error("Failed to update playlist");
      console.error("Update playlist error:", error);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      updatePlaylist.mutate({ name: name.trim(), comment: comment.trim() });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="w-5 h-5" />
              Edit Playlist
            </DialogTitle>
            <DialogDescription>
              Update your playlist&apos;s name and description.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="playlist-name">Name</Label>
              <Input
                id="playlist-name"
                placeholder="My Playlist"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="playlist-comment">Description</Label>
              <Textarea
                id="playlist-comment"
                placeholder="Add a description..."
                value={comment}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  setComment(e.target.value)
                }
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!name.trim() || updatePlaylist.isPending}
            >
              {updatePlaylist.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
