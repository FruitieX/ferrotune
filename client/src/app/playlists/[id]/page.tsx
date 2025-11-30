"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useSetAtom } from "jotai";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Play,
  Shuffle,
  MoreHorizontal,
  Clock,
  Pencil,
  Trash2,
  ListMusic,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/hooks/use-auth";
import { playNowAtom, isShuffledAtom } from "@/lib/store/queue";
import { getClient } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { CoverImage } from "@/components/shared/cover-image";
import { TrackList } from "@/components/browse/track-list";
import { EditPlaylistDialog } from "@/components/playlists/edit-playlist-dialog";
import { formatDuration, formatCount, formatDate } from "@/lib/utils/format";

export default function PlaylistDetailPage() {
  const router = useRouter();
  const params = useParams();
  const playlistId = params.id as string;

  const { isReady, isLoading: authLoading } = useAuth({ redirectToLogin: true });
  const playNow = useSetAtom(playNowAtom);
  const setIsShuffled = useSetAtom(isShuffledAtom);
  const queryClient = useQueryClient();

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  // Fetch playlist details
  const { data: playlist, isLoading } = useQuery({
    queryKey: ["playlist", playlistId],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getPlaylist(playlistId);
      return response.playlist;
    },
    enabled: isReady && !!playlistId,
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      await client.deletePlaylist(playlistId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      toast.success("Playlist deleted");
      router.push("/playlists");
    },
    onError: () => {
      toast.error("Failed to delete playlist");
    },
  });

  const songs = playlist?.entry ?? [];

  const coverArtUrl = playlist?.coverArt
    ? getClient()?.getCoverArtUrl(playlist.coverArt, 300)
    : undefined;

  const handlePlayAll = () => {
    if (songs.length > 0) {
      setIsShuffled(false);
      playNow(songs);
    }
  };

  const handleShuffle = () => {
    if (songs.length > 0) {
      setIsShuffled(true);
      const shuffled = [...songs].sort(() => Math.random() - 0.5);
      playNow(shuffled);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen">
        {/* Header with gradient background */}
        <div className="relative">
          <div className="absolute inset-0 h-[400px] bg-gradient-to-b from-primary/20 to-background" />
          <div className="relative z-10 px-4 lg:px-6 pt-8 pb-6">
            <div className="flex flex-col md:flex-row items-center md:items-end gap-6">
              <Skeleton className="w-48 h-48 md:w-56 md:h-56 rounded-lg" />
              <div className="space-y-4 text-center md:text-left">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-10 w-64" />
                <Skeleton className="h-4 w-48" />
              </div>
            </div>
          </div>
        </div>
        {/* Action buttons skeleton */}
        <div className="px-4 lg:px-6 py-4 border-b border-border">
          <div className="flex items-center gap-4">
            <Skeleton className="h-12 w-28 rounded-full" />
            <Skeleton className="h-12 w-28 rounded-full" />
            <Skeleton className="h-10 w-10 rounded-full" />
          </div>
        </div>
        {/* Track list skeleton */}
        <div className="px-4 lg:px-6 py-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 py-2">
              <Skeleton className="w-8 h-4" />
              <Skeleton className="w-10 h-10 rounded" />
              <div className="flex-1">
                <Skeleton className="h-4 w-40 mb-1" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="h-4 w-10" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Header with gradient background */}
      <div className="relative">
        <div
          className="absolute inset-0 h-[400px]"
          style={{
            background: `linear-gradient(180deg, rgba(var(--primary-rgb, 30, 215, 96), 0.2) 0%, rgba(10,10,10,1) 100%)`,
          }}
        />

        <div className="relative z-10 px-4 lg:px-6 pt-8 pb-6">
          {isLoading ? (
            <div className="flex flex-col md:flex-row items-center md:items-end gap-6">
              <Skeleton className="w-48 h-48 md:w-56 md:h-56 rounded-lg" />
              <div className="space-y-4 text-center md:text-left">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-10 w-64" />
                <Skeleton className="h-4 w-48" />
              </div>
            </div>
          ) : playlist ? (
            <div className="flex flex-col md:flex-row items-center md:items-end gap-6">
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="w-48 h-48 md:w-56 md:h-56 shrink-0"
              >
                <CoverImage
                  src={coverArtUrl}
                  alt={playlist.name}
                  size="full"
                  type="playlist"
                  className="rounded-lg shadow-2xl"
                  priority
                />
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="text-center md:text-left"
              >
                <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                  Playlist
                </span>
                <h1 className="text-3xl md:text-5xl font-bold mt-2">
                  {playlist.name}
                </h1>
                {playlist.comment && (
                  <p className="mt-4 text-muted-foreground max-w-lg">
                    {playlist.comment}
                  </p>
                )}
                <div className="mt-4 flex flex-wrap items-center justify-center md:justify-start gap-2 text-sm text-muted-foreground">
                  {playlist.owner && (
                    <>
                      <span className="font-medium text-foreground">{playlist.owner}</span>
                      <span>•</span>
                    </>
                  )}
                  <span>{formatCount(playlist.songCount, "song")}</span>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatDuration(playlist.duration)}
                  </span>
                  {playlist.created && (
                    <>
                      <span>•</span>
                      <span>Created {formatDate(playlist.created)}</span>
                    </>
                  )}
                </div>
              </motion.div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Action buttons */}
      <div className="sticky top-0 z-20 bg-background/80 backdrop-blur-lg border-b border-border">
        <div className="flex items-center gap-4 px-4 lg:px-6 py-4">
          <Button
            size="lg"
            className="rounded-full gap-2 px-8"
            onClick={handlePlayAll}
            disabled={isLoading || songs.length === 0}
          >
            <Play className="w-5 h-5 ml-0.5" />
            Play
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="rounded-full gap-2"
            onClick={handleShuffle}
            disabled={isLoading || songs.length === 0}
          >
            <Shuffle className="w-5 h-5" />
            Shuffle
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="ml-auto">
                <MoreHorizontal className="w-5 h-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setEditDialogOpen(true)}>
                <Pencil className="w-4 h-4 mr-2" />
                Edit Playlist
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => setDeleteDialogOpen(true)}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Playlist
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Track list */}
      <TrackList
        songs={songs}
        isLoading={isLoading}
        showCover
        showHeader
        emptyMessage="This playlist is empty"
      />

      {/* Spacer for player bar */}
      <div className="h-24" />

      {/* Delete confirmation dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete playlist?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &quot;{playlist?.name}&quot;. This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit playlist dialog */}
      <EditPlaylistDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        playlist={playlist ? { id: playlist.id, name: playlist.name, comment: playlist.comment } : null}
      />
    </div>
  );
}
