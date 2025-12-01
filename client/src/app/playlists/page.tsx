"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import Link from "next/link";
import { Plus, ListMusic, Music2, Clock } from "lucide-react";
import { useAuth } from "@/lib/hooks/use-auth";
import { getClient } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CoverImage } from "@/components/shared/cover-image";
import { CreatePlaylistDialog } from "@/components/playlists/create-playlist-dialog";
import { PlaylistContextMenu, PlaylistDropdownMenu } from "@/components/playlists/playlist-context-menu";
import { formatDuration, formatCount, formatDate } from "@/lib/utils/format";
import type { Playlist } from "@/lib/api/types";

export default function PlaylistsPage() {
  const { isReady, isLoading: authLoading } = useAuth({ redirectToLogin: true });
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  // Fetch playlists
  const { data: playlists, isLoading } = useQuery({
    queryKey: ["playlists"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getPlaylists();
      return response.playlists.playlist ?? [];
    },
    enabled: isReady,
  });

  if (authLoading) {
    return (
      <div className="min-h-screen">
        {/* Header skeleton */}
        <div className="px-4 lg:px-6 pt-8 pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Skeleton className="w-12 h-12 rounded-lg" />
              <div>
                <Skeleton className="h-8 w-32 mb-1" />
                <Skeleton className="h-4 w-20" />
              </div>
            </div>
            <Skeleton className="h-10 w-36 rounded-full" />
          </div>
        </div>
        {/* Grid skeleton */}
        <div className="px-4 lg:px-6 pb-24">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <PlaylistCardSkeleton key={i} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="px-4 lg:px-6 pt-8 pb-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
              <ListMusic className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Playlists</h1>
              <p className="text-sm text-muted-foreground">
                {isLoading ? "Loading..." : formatCount(playlists?.length ?? 0, "playlist")}
              </p>
            </div>
          </div>
          <Button className="rounded-full gap-2" onClick={() => setCreateDialogOpen(true)}>
            <Plus className="w-4 h-4" />
            Create Playlist
          </Button>
        </motion.div>
      </div>

      {/* Create Playlist Dialog */}
      <CreatePlaylistDialog 
        open={createDialogOpen} 
        onOpenChange={setCreateDialogOpen} 
      />

      {/* Playlists grid */}
      <div className="px-4 lg:px-6 pb-24">
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <PlaylistCardSkeleton key={i} />
            ))}
          </div>
        ) : playlists && playlists.length > 0 ? (
          <motion.div
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
            initial="hidden"
            animate="visible"
            variants={{
              visible: { transition: { staggerChildren: 0.05 } },
            }}
          >
            {playlists.map((playlist) => (
              <motion.div
                key={playlist.id}
                variants={{
                  hidden: { opacity: 0, y: 20 },
                  visible: { opacity: 1, y: 0 },
                }}
              >
                <PlaylistCard playlist={playlist} />
              </motion.div>
            ))}
          </motion.div>
        ) : (
          <EmptyState onCreateClick={() => setCreateDialogOpen(true)} />
        )}
      </div>
    </div>
  );
}

function PlaylistCard({ playlist }: { playlist: Playlist }) {
  const coverArtUrl = playlist.coverArt
    ? getClient()?.getCoverArtUrl(playlist.coverArt, 300)
    : undefined;

  return (
    <PlaylistContextMenu playlist={playlist}>
      <Link
        href={`/playlists/details?id=${playlist.id}`}
        className="group block p-4 rounded-lg bg-card hover:bg-accent/50 transition-colors relative"
      >
        <PlaylistDropdownMenu playlist={playlist} />
        <div className="relative mb-4">
          <CoverImage
            src={coverArtUrl}
            alt={playlist.name || "Playlist cover"}
            size="full"
            type="playlist"
            className="rounded-md shadow-lg"
          />
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-md flex items-center justify-center">
            <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center shadow-xl">
              <Music2 className="w-6 h-6 text-primary-foreground" />
            </div>
          </div>
        </div>
        <h3 className="font-semibold truncate">{playlist.name}</h3>
        <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
          <span>{formatCount(playlist.songCount, "song")}</span>
          <span>•</span>
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {formatDuration(playlist.duration)}
          </span>
        </div>
        {playlist.comment && (
          <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
            {playlist.comment}
          </p>
        )}
      </Link>
    </PlaylistContextMenu>
  );
}

function PlaylistCardSkeleton() {
  return (
    <div className="p-4 rounded-lg bg-card">
      <Skeleton className="aspect-square rounded-md mb-4" />
      <Skeleton className="h-5 w-3/4 mb-2" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  );
}

function EmptyState({ onCreateClick }: { onCreateClick: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-24 h-24 rounded-full bg-muted flex items-center justify-center mb-4">
        <ListMusic className="w-10 h-10 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold mb-2">No playlists yet</h3>
      <p className="text-muted-foreground mb-6 max-w-sm">
        Create your first playlist to organize your favorite music.
      </p>
      <Button className="rounded-full gap-2" onClick={onCreateClick}>
        <Plus className="w-4 h-4" />
        Create Playlist
      </Button>
    </div>
  );
}
