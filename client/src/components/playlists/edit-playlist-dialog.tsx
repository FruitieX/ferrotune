"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Loader2, X, UserPlus, Users } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { getClient } from "@/lib/api/client";
import type { ShareEntry } from "@/lib/api/generated/ShareEntry";

interface ShareState {
  userId: number;
  username: string;
  canEdit: boolean;
}

interface EditPlaylistDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playlist: {
    id: string;
    name: string;
    comment?: string;
  } | null;
  isOwner?: boolean;
}

export function EditPlaylistDialog({
  open,
  onOpenChange,
  playlist,
  isOwner = true,
}: EditPlaylistDialogProps) {
  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const [prevPlaylistId, setPrevPlaylistId] = useState<string | null>(null);
  const [shares, setShares] = useState<ShareState[]>([]);
  const [sharesLoaded, setSharesLoaded] = useState(false);
  const [addUserOpen, setAddUserOpen] = useState(false);
  const queryClient = useQueryClient();

  // Update form when playlist changes (React-recommended pattern for adjusting state when props change)
  if (playlist && playlist.id !== prevPlaylistId) {
    setPrevPlaylistId(playlist.id);
    setName(playlist.name);
    setComment(playlist.comment ?? "");
    setSharesLoaded(false);
  }

  // Fetch current shares when dialog opens (owner only)
  const { data: currentShares } = useQuery({
    queryKey: ["playlistShares", playlist?.id],
    queryFn: async () => {
      const client = getClient();
      if (!client || !playlist) throw new Error("Not connected");
      return client.getPlaylistShares(playlist.id);
    },
    enabled: open && isOwner && !!playlist,
  });

  // Sync fetched shares into local state once
  if (currentShares && !sharesLoaded) {
    setSharesLoaded(true);
    setShares(
      currentShares.shares.map((s) => ({
        userId: s.userId,
        username: s.username,
        canEdit: s.canEdit,
      })),
    );
  }

  // Fetch shareable users (owner only)
  const { data: shareableUsers } = useQuery({
    queryKey: ["shareableUsers"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.getShareableUsers();
    },
    enabled: open && isOwner,
  });

  // Users not yet in the shares list
  const availableUsers =
    shareableUsers?.users.filter(
      (u) => !shares.some((s) => s.userId === u.id),
    ) ?? [];

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

      // Update playlist metadata
      await client.updatePlaylist({
        playlistId: playlist.id,
        name,
        comment: comment || undefined,
      });

      // Update shares if owner
      if (isOwner) {
        const shareEntries: ShareEntry[] = shares.map((s) => ({
          userId: s.userId,
          canEdit: s.canEdit,
        }));
        await client.setPlaylistShares(playlist.id, shareEntries);
      }
    },
    onSuccess: () => {
      toast.success(`Playlist updated successfully`);
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      queryClient.invalidateQueries({ queryKey: ["playlistFolders"] });
      queryClient.invalidateQueries({
        queryKey: ["playlistSongs", playlist?.id],
      });
      queryClient.invalidateQueries({
        queryKey: ["playlistShares", playlist?.id],
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

  const addShare = (userId: number, username: string) => {
    setShares((prev) => [...prev, { userId, username, canEdit: false }]);
    setAddUserOpen(false);
  };

  const removeShare = (userId: number) => {
    setShares((prev) => prev.filter((s) => s.userId !== userId));
  };

  const toggleCanEdit = (userId: number) => {
    setShares((prev) =>
      prev.map((s) =>
        s.userId === userId ? { ...s, canEdit: !s.canEdit } : s,
      ),
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
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

            {isOwner && (
              <>
                <Separator />
                <div className="grid gap-3">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-muted-foreground" />
                    <Label>Sharing</Label>
                  </div>

                  {shares.length > 0 && (
                    <div className="space-y-2">
                      {shares.map((share) => (
                        <div
                          key={share.userId}
                          className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
                        >
                          <span className="text-sm font-medium truncate">
                            {share.username}
                          </span>
                          <div className="flex items-center gap-3 shrink-0">
                            <div className="flex items-center gap-2">
                              <Label
                                htmlFor={`edit-${share.userId}`}
                                className="text-xs text-muted-foreground"
                              >
                                Can edit
                              </Label>
                              <Switch
                                id={`edit-${share.userId}`}
                                checked={share.canEdit}
                                onCheckedChange={() =>
                                  toggleCanEdit(share.userId)
                                }
                              />
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => removeShare(share.userId)}
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {availableUsers.length > 0 && (
                    <Popover open={addUserOpen} onOpenChange={setAddUserOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="w-fit"
                        >
                          <UserPlus className="w-4 h-4 mr-2" />
                          Share with user
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="p-0 w-[200px]" align="start">
                        <Command>
                          <CommandInput placeholder="Search users..." />
                          <CommandList>
                            <CommandEmpty>No users found.</CommandEmpty>
                            <CommandGroup>
                              {availableUsers.map((user) => (
                                <CommandItem
                                  key={user.id}
                                  onSelect={() =>
                                    addShare(user.id, user.username)
                                  }
                                >
                                  {user.username}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  )}

                  {shares.length === 0 && availableUsers.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No other users to share with.
                    </p>
                  )}
                </div>
              </>
            )}
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
