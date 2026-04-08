"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { Radio } from "lucide-react";
import { useAuth } from "@/lib/hooks/use-auth";
import { getClient } from "@/lib/api/client";
import { startQueueAtom } from "@/lib/store/server-queue";
import { DetailHeader } from "@/components/shared/detail-header";
import { ActionBar } from "@/components/shared/action-bar";
import { EmptyState } from "@/components/shared/empty-state";
import { SongListHeader } from "@/components/shared/song-list-header";
import { VirtualizedList } from "@/components/shared/virtualized-grid";
import { SongRow, SongRowSkeleton } from "@/components/browse/song-row";
import { formatTotalDuration } from "@/lib/utils/format";
import type { Song } from "@/lib/api/types";
import type { ColumnVisibility } from "@/lib/store/ui";

const RADIO_SONG_COUNT = 100;
const RADIO_COLUMN_VISIBILITY: ColumnVisibility = {
  trackNumber: true,
  artist: true,
  album: true,
  duration: true,
  playCount: false,
  year: false,
  dateAdded: false,
  lastPlayed: false,
  starred: false,
  genre: false,
  bitRate: false,
  format: false,
  rating: false,
};

function SongRadioPageContent() {
  const searchParams = useSearchParams();
  const seedSongId = searchParams.get("id");
  const startQueue = useSetAtom(startQueueAtom);
  const { isReady, isLoading: authLoading } = useAuth({
    redirectToLogin: true,
  });

  const { data: seedSongResponse, isLoading: loadingSeedSong } = useQuery({
    queryKey: ["songRadioSeed", seedSongId],
    queryFn: async () => {
      const client = getClient();
      if (!client || !seedSongId) throw new Error("Not connected");
      return client.getSong(seedSongId);
    },
    enabled: isReady && !!seedSongId,
  });

  const { data: similarSongsResponse, isLoading: loadingSimilarSongs } =
    useQuery({
      queryKey: ["songRadioSongs", seedSongId],
      queryFn: async () => {
        const client = getClient();
        if (!client || !seedSongId) throw new Error("Not connected");
        return client.getSimilarSongs(seedSongId, {
          count: RADIO_SONG_COUNT - 1,
        });
      },
      enabled: isReady && !!seedSongId,
      staleTime: 0,
      gcTime: 0,
    });

  const seedSong = seedSongResponse?.song as Song | undefined;
  const radioName = seedSong ? `${seedSong.title} Radio` : "Song Radio";
  const radioSongs = seedSong
    ? [
        seedSong,
        ...((similarSongsResponse?.songs as Song[] | undefined) ?? []).filter(
          (song) => song.id !== seedSong.id,
        ),
      ].slice(0, RADIO_SONG_COUNT)
    : [];
  const totalDuration = radioSongs.reduce(
    (sum, song) => sum + song.duration,
    0,
  );
  const isLoading = authLoading || loadingSeedSong || loadingSimilarSongs;
  const coverUrl = seedSong?.coverArt
    ? getClient()?.getCoverArtUrl(seedSong.coverArt, "medium")
    : null;

  const playRadio = (startIndex = 0, shuffle = false, startSongId?: string) => {
    if (!seedSong || radioSongs.length === 0) {
      return;
    }

    startQueue({
      sourceType: "songRadio",
      sourceId: seedSong.id,
      sourceName: radioName,
      songIds: radioSongs.map((song) => song.id),
      startIndex,
      startSongId,
      shuffle,
    });
  };

  if (!isLoading && !seedSongId) {
    return (
      <div className="px-4 lg:px-6 py-8">
        <EmptyState
          icon={Radio}
          title="Missing radio seed"
          description="Open Song Radio from a song or Continue Listening to load a radio session."
        />
      </div>
    );
  }

  return (
    <>
      <DetailHeader
        showBackButton
        icon={Radio}
        coverUrl={coverUrl}
        fullSizeCoverUrl={coverUrl}
        coverType="song"
        colorSeed={radioName}
        label="Radio"
        title={radioName}
        subtitle={
          !isLoading &&
          radioSongs.length > 0 &&
          `${radioSongs.length} songs • ${formatTotalDuration(totalDuration)}`
        }
        metadata={
          !isLoading && seedSong ? (
            <span className="text-sm text-muted-foreground">
              Based on {seedSong.title} by {seedSong.artist}
            </span>
          ) : undefined
        }
        isLoading={isLoading}
      />

      <ActionBar
        onPlayAll={() => playRadio(0, false)}
        onShuffle={() => playRadio(0, true)}
        disablePlay={isLoading || radioSongs.length === 0}
      />

      <div className="px-4 lg:px-6 py-4">
        {radioSongs.length > 0 ? (
          <>
            <SongListHeader
              columnVisibility={RADIO_COLUMN_VISIBILITY}
              showIndex
              showCover
            />
            <VirtualizedList
              items={radioSongs}
              renderItem={(song, index) => (
                <SongRow
                  song={song}
                  index={index}
                  showCover
                  showArtist
                  showAlbum
                  showDuration
                  queueSongs={radioSongs}
                  queueSource={{
                    type: "songRadio",
                    id: seedSong?.id,
                    name: radioName,
                  }}
                />
              )}
              renderSkeleton={() => <SongRowSkeleton showCover showIndex />}
              getItemKey={(song) => song.id}
              estimateItemHeight={56}
            />
          </>
        ) : !isLoading ? (
          <EmptyState
            icon={Radio}
            title="No similar songs found"
            description="This song doesn’t have enough analysis data to build a radio yet."
          />
        ) : null}
      </div>

      <div className="h-24" />
    </>
  );
}

export default function SongRadioPage() {
  return (
    <Suspense>
      <SongRadioPageContent />
    </Suspense>
  );
}
