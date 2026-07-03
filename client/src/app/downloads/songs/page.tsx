"use client";

import { useEffect, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { ListMusic } from "lucide-react";
import { useAuth } from "@/lib/hooks/use-auth";
import { useIsMounted } from "@/lib/hooks/use-is-mounted";
import { downloadStateMapAtom } from "@/lib/store/downloads";
import { startQueueAtom } from "@/lib/store/server-queue";
import { getSortedDownloadedSongs } from "@/lib/offline/downloaded-songs";
import { DetailHeader } from "@/components/shared/detail-header";
import { ActionBar } from "@/components/shared/action-bar";
import { EmptyState } from "@/components/shared/empty-state";
import { VirtualizedList } from "@/components/shared/virtualized-grid";
import { SongListHeader } from "@/components/shared/song-list-header";
import { SongRow, SongRowSkeleton } from "@/components/browse/song-row";
import { Skeleton } from "@/components/ui/skeleton";
import type { Song } from "@/lib/api/types";
import type { ColumnVisibility } from "@/lib/store/ui";

const downloadedSongsColumns: ColumnVisibility = {
  trackNumber: true,
  artist: true,
  album: true,
  duration: true,
  playCount: false,
  playStarts: false,
  dateAdded: false,
  lastPlayed: false,
  year: false,
  starred: false,
  genre: false,
  bitRate: false,
  format: false,
  rating: false,
};

export default function DownloadedSongsPage() {
  const { isLoading: authLoading } = useAuth({ redirectToLogin: true });
  const isMounted = useIsMounted();
  const startQueue = useSetAtom(startQueueAtom);
  const downloadState = useAtomValue(downloadStateMapAtom);
  const [songs, setSongs] = useState<Song[]>([]);
  const [isLoadingSongs, setIsLoadingSongs] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingSongs(true);
    getSortedDownloadedSongs()
      .then((downloadedSongs) => {
        if (cancelled) return;
        setSongs(downloadedSongs);
      })
      .catch((error) => {
        console.warn("[downloads] failed to load downloaded songs", error);
        if (!cancelled) setSongs([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingSongs(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const completedSongIds = new Set(
    Array.from(downloadState)
      .filter(([, state]) => state.status === "completed")
      .map(([songId]) => songId),
  );
  const displaySongs = completedSongIds.size
    ? songs.filter((song) => completedSongIds.has(song.id))
    : songs;
  const songIds = displaySongs.map((song) => song.id);

  const play = (shuffle: boolean) => {
    startQueue({
      sourceType: "other",
      sourceName: "Downloaded Songs",
      songIds,
      startIndex: 0,
      shuffle,
    });
  };

  if (!isMounted || authLoading) {
    return (
      <div className="min-h-dvh">
        <DetailHeader
          showBackButton
          icon={ListMusic}
          iconClassName="bg-linear-to-br from-amber-500 to-orange-700"
          gradientColor="rgba(245,158,11,0.2)"
          label="Downloads"
          title="Downloaded Songs"
          isLoading
        />
        <div className="px-4 lg:px-6 py-4 flex items-center gap-4 border-b border-border">
          <Skeleton className="h-12 w-24 rounded-full" />
          <Skeleton className="h-12 w-28 rounded-full" />
        </div>
        <div className="px-4 lg:px-6 py-4 space-y-1">
          {Array.from({ length: 10 }).map((_, index) => (
            <SongRowSkeleton key={index} showCover showIndex />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh">
      <DetailHeader
        showBackButton
        icon={ListMusic}
        iconClassName="bg-linear-to-br from-amber-500 to-orange-700"
        gradientColor="rgba(245,158,11,0.2)"
        label="Downloads"
        title="Downloaded Songs"
        isLoading={isLoadingSongs}
        metadata={
          !isLoadingSongs && (
            <span>
              {displaySongs.length} downloaded song
              {displaySongs.length === 1 ? "" : "s"} on this device
            </span>
          )
        }
      />
      <ActionBar
        onPlayAll={() => play(false)}
        onShuffle={() => play(true)}
        disablePlay={isLoadingSongs || displaySongs.length === 0}
        showShuffleOnMobile
      />
      <div className="px-4 lg:px-6 py-4">
        {isLoadingSongs ? (
          <div className="space-y-1">
            {Array.from({ length: 10 }).map((_, index) => (
              <SongRowSkeleton key={index} showCover showIndex />
            ))}
          </div>
        ) : displaySongs.length > 0 ? (
          <>
            <SongListHeader
              columnVisibility={downloadedSongsColumns}
              showCover
            />
            <VirtualizedList
              items={displaySongs}
              renderItem={(song, index) => (
                <SongRow
                  song={song}
                  index={index}
                  showCover
                  inlineImagesRequested
                  queueSongs={displaySongs}
                  queueSource={{ type: "other", name: "Downloaded Songs" }}
                  disableLibraryLinks
                />
              )}
              renderSkeleton={() => <SongRowSkeleton showCover showIndex />}
              getItemKey={(song) => song.id}
              estimateItemHeight={56}
            />
          </>
        ) : (
          <EmptyState
            icon={ListMusic}
            title="No downloaded songs"
            description="Songs saved for offline playback will appear here."
          />
        )}
      </div>
      <div className="h-24" />
    </div>
  );
}
