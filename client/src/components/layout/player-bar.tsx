"use client";

import { memo, useCallback, useMemo } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { motion } from "framer-motion";
import Link from "next/link";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Volume1,
  Repeat,
  Repeat1,
  Shuffle,
  ListMusic,
  Maximize2,
  Heart,
  MoreHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  useAudioEngine,
  useVolumeControl,
  useRepeatMode,
  useShuffle,
} from "@/lib/audio/hooks";
import {
  currentTimeAtom,
  durationAtom,
  playbackStateAtom,
} from "@/lib/store/player";
import { currentSongAtom } from "@/lib/store/server-queue";
import {
  queuePanelOpenAtom,
  fullscreenPlayerOpenAtom,
  progressBarStyleAtom,
} from "@/lib/store/ui";
import { serverConnectionAtom } from "@/lib/store/auth";
import { useStarred } from "@/lib/store/starred";
import { formatDuration } from "@/lib/utils/format";
import { getClient } from "@/lib/api/client";
import type { Song } from "@/lib/api/types";

import { SongDropdownMenu } from "@/components/browse/song-context-menu";
import { CoverImage } from "@/components/shared/cover-image";
import { WaveformProgressBar } from "@/components/player/waveform-progress-bar";
import { SimpleProgressBar } from "@/components/player/simple-progress-bar";

// ============================================================================
// Memoized Sub-Components
// These components are split out to prevent re-renders when currentTimeAtom updates
// ============================================================================

interface NowPlayingInfoProps {
  track: Song | null;
  isEnded: boolean;
}

/** Now playing track info - only re-renders when track changes */
const NowPlayingInfo = memo(function NowPlayingInfo({
  track,
  isEnded,
}: NowPlayingInfoProps) {
  // Use global starred state
  const { isStarred, toggleStar } = useStarred(
    track?.id ?? "",
    !!track?.starred,
  );

  // Get cover art URL
  const coverArtUrl = useMemo(() => {
    return track?.coverArt
      ? getClient()?.getCoverArtUrl(track.coverArt, 96)
      : null;
  }, [track?.coverArt]);

  if (!track || isEnded) {
    return (
      <div className="flex items-center gap-3">
        <div className="w-14 h-14 rounded-md bg-muted" />
        <div>
          <p className="text-sm text-muted-foreground">Not playing</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <motion.div
        key={track.id}
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="shrink-0 album-glow"
      >
        <CoverImage
          src={coverArtUrl}
          alt={track.album || "Album cover"}
          colorSeed={track.album || track.title}
          type="song"
          size="sm"
          className="w-14 h-14"
        />
      </motion.div>
      <div className="min-w-0">
        <Link
          href={`/library/albums/details?id=${track.albumId}`}
          className="block text-sm font-medium text-foreground truncate hover:underline"
        >
          {track.title}
        </Link>
        <Link
          href={`/library/artists/details?id=${track.artistId}`}
          className="block text-xs text-muted-foreground truncate hover:underline"
        >
          {track.artist}
        </Link>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="hidden sm:flex shrink-0 h-8 w-8"
        onClick={toggleStar}
      >
        <Heart
          className={cn("w-4 h-4", isStarred && "fill-red-500 text-red-500")}
        />
      </Button>
      <div className="hidden sm:block">
        <SongDropdownMenu song={track} />
      </div>
    </>
  );
});

interface PlaybackControlsProps {
  hasTrack: boolean;
  playbackState: "idle" | "loading" | "playing" | "paused" | "ended" | "error";
}

/** Play/pause and skip buttons - only re-renders when playback state changes */
const PlaybackControls = memo(function PlaybackControls({
  hasTrack,
  playbackState,
}: PlaybackControlsProps) {
  const { togglePlayPause, next, previous } = useAudioEngine();
  const { isShuffled, toggleShuffle } = useShuffle();
  const { repeatMode, cycleRepeatMode } = useRepeatMode();

  const isPlaying = playbackState === "playing";
  const isLoading = playbackState === "loading";
  const RepeatIcon = repeatMode === "one" ? Repeat1 : Repeat;

  return (
    <div className="flex items-center gap-1 sm:gap-2">
      {/* Shuffle - hidden on mobile, shown in more menu */}
      <Button
        variant="ghost"
        size="icon"
        className={cn("hidden sm:flex h-8 w-8", isShuffled && "text-primary")}
        onClick={toggleShuffle}
        aria-label="Shuffle"
      >
        <Shuffle className="w-4 h-4" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 sm:h-9 sm:w-9"
        onClick={previous}
        disabled={!hasTrack}
        aria-label="Previous"
      >
        <SkipBack className="w-4 h-4 sm:w-5 sm:h-5" />
      </Button>

      <Button
        variant="default"
        size="icon"
        className="h-9 w-9 sm:h-10 sm:w-10 rounded-full"
        onClick={togglePlayPause}
        disabled={playbackState === "idle"}
        aria-label={isPlaying ? "Pause" : "Play"}
      >
        {isLoading ? (
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
            className="w-4 h-4 sm:w-5 sm:h-5 border-2 border-primary-foreground border-t-transparent rounded-full"
          />
        ) : isPlaying ? (
          <Pause className="w-4 h-4 sm:w-5 sm:h-5" />
        ) : (
          <Play className="w-4 h-4 sm:w-5 sm:h-5 ml-0.5" />
        )}
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 sm:h-9 sm:w-9"
        onClick={next}
        disabled={!hasTrack}
        aria-label="Next"
      >
        <SkipForward className="w-4 h-4 sm:w-5 sm:h-5" />
      </Button>

      {/* Repeat - hidden on mobile, shown in more menu */}
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "hidden sm:flex h-8 w-8",
          repeatMode !== "off" && "text-primary",
        )}
        onClick={cycleRepeatMode}
        aria-label="Repeat"
      >
        <RepeatIcon className="w-4 h-4" />
      </Button>
    </div>
  );
});

/** Time slider and duration display - this component subscribes to currentTimeAtom */
const TimeSlider = memo(function TimeSlider() {
  const currentTime = useAtomValue(currentTimeAtom);
  const duration = useAtomValue(durationAtom);
  const playbackState = useAtomValue(playbackStateAtom);
  const { seekPercent } = useAudioEngine();

  const isEnded = playbackState === "ended";
  const progress = isEnded
    ? 0
    : duration > 0
      ? (currentTime / duration) * 100
      : 0;
  const displayTime = isEnded ? 0 : currentTime;
  const displayDuration = isEnded ? 0 : duration;

  return (
    <div className="hidden sm:flex items-center gap-2 w-full max-w-md text-xs text-muted-foreground">
      <span className="w-10 text-right tabular-nums">
        {formatDuration(displayTime)}
      </span>
      <Slider
        value={[progress]}
        max={100}
        step={0.1}
        className="flex-1"
        onValueChange={([value]) => seekPercent(value)}
        disabled={isEnded}
      />
      <span className="w-10 tabular-nums">
        {formatDuration(displayDuration)}
      </span>
    </div>
  );
});

/** Volume controls - separated to avoid re-renders from time updates */
const VolumeControls = memo(function VolumeControls() {
  const { volume, isMuted, toggleMute, changeVolume } = useVolumeControl();

  const VolumeIcon =
    isMuted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  // Handle scroll wheel to adjust volume
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      // Scroll up = increase volume, scroll down = decrease
      // Use small step (5%) for fine control
      const delta = e.deltaY < 0 ? 0.05 : -0.05;
      const newVolume = Math.max(0, Math.min(1, volume + delta));
      changeVolume(newVolume);
    },
    [volume, changeVolume],
  );

  return (
    <>
      {/* Volume control - popover on mobile, inline on desktop */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 sm:hidden"
            aria-label={isMuted ? "Unmute" : "Mute"}
          >
            <VolumeIcon className="w-4 h-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent side="top" align="center" className="w-auto p-3">
          <div className="flex flex-col items-center gap-3">
            <span className="text-xs text-muted-foreground">Volume</span>
            <div className="h-32 flex items-center">
              <Slider
                orientation="vertical"
                value={[isMuted ? 0 : volume * 100]}
                max={100}
                step={1}
                className="h-full"
                onValueChange={([value]) => changeVolume(value / 100)}
                aria-label="Volume"
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={toggleMute}
              aria-label={isMuted ? "Unmute" : "Mute"}
            >
              <VolumeIcon className="w-4 h-4" />
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {/* Desktop volume - hidden on mobile */}
      <div
        className="hidden sm:flex items-center gap-2 w-32"
        onWheel={handleWheel}
      >
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={toggleMute}
          aria-label={isMuted ? "Unmute" : "Mute"}
        >
          <VolumeIcon className="w-4 h-4" />
        </Button>
        <Slider
          value={[isMuted ? 0 : volume * 100]}
          max={100}
          step={1}
          className="flex-1"
          onValueChange={([value]) => changeVolume(value / 100)}
          aria-label="Volume"
        />
      </div>
    </>
  );
});

/** Queue button - separated to avoid re-renders */
const QueueButton = memo(function QueueButton() {
  const [queuePanelOpen, setQueuePanelOpen] = useAtom(queuePanelOpenAtom);

  const toggleQueue = useCallback(() => {
    setQueuePanelOpen(!queuePanelOpen);
  }, [queuePanelOpen, setQueuePanelOpen]);

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      onClick={toggleQueue}
      aria-label="Queue"
    >
      <ListMusic className="w-4 h-4" />
    </Button>
  );
});

/** Mobile more options menu - separated to avoid re-renders */
const MobileMoreMenu = memo(function MobileMoreMenu() {
  const setFullscreenOpen = useSetAtom(fullscreenPlayerOpenAtom);
  const { isShuffled, toggleShuffle } = useShuffle();
  const { repeatMode, cycleRepeatMode } = useRepeatMode();

  const RepeatIcon = repeatMode === "one" ? Repeat1 : Repeat;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 sm:hidden"
          aria-label="More options"
        >
          <MoreHorizontal className="w-4 h-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-auto p-2">
        <div className="flex flex-col gap-1">
          <Button
            variant="ghost"
            size="sm"
            className={cn("justify-start gap-2", isShuffled && "text-primary")}
            onClick={toggleShuffle}
          >
            <Shuffle className="w-4 h-4" />
            Shuffle {isShuffled && "On"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "justify-start gap-2",
              repeatMode !== "off" && "text-primary",
            )}
            onClick={cycleRepeatMode}
          >
            <RepeatIcon className="w-4 h-4" />
            Repeat{" "}
            {repeatMode === "one"
              ? "One"
              : repeatMode === "all"
                ? "All"
                : "Off"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="justify-start gap-2"
            onClick={() => setFullscreenOpen(true)}
          >
            <Maximize2 className="w-4 h-4" />
            Fullscreen
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
});

/** Fullscreen button - separated to avoid re-renders */
const FullscreenButton = memo(function FullscreenButton() {
  const setFullscreenOpen = useSetAtom(fullscreenPlayerOpenAtom);

  return (
    <Button
      variant="ghost"
      size="icon"
      className="hidden sm:flex h-8 w-8"
      onClick={() => setFullscreenOpen(true)}
      aria-label="Fullscreen"
    >
      <Maximize2 className="w-4 h-4" />
    </Button>
  );
});

// ============================================================================
// Main PlayerBar Component
// ============================================================================

export function PlayerBar() {
  const currentTrack = useAtomValue(currentSongAtom);
  const playbackState = useAtomValue(playbackStateAtom);
  const connection = useAtomValue(serverConnectionAtom);
  const progressBarStyle = useAtomValue(progressBarStyleAtom);

  const isEnded = playbackState === "ended";
  const hasTrack = !!currentTrack;

  if (!connection) {
    return null;
  }

  return (
    <footer
      data-testid="player-bar"
      className={cn(
        "relative z-50",
        "h-[88px] bg-background/95 backdrop-blur-lg",
        "transition-all duration-200",
      )}
    >
      {/* Progress bar at top - waveform or simple based on preference */}
      {progressBarStyle === "waveform" ? (
        <WaveformProgressBar />
      ) : (
        <SimpleProgressBar />
      )}

      <div className="flex items-center h-full px-4 gap-4">
        {/* Now Playing Info */}
        <div className="flex items-center gap-3 w-[30%] min-w-0">
          <NowPlayingInfo track={currentTrack} isEnded={isEnded} />
        </div>

        {/* Center Controls */}
        <div className="flex flex-col items-center gap-1 flex-1 max-w-[40%]">
          <PlaybackControls hasTrack={hasTrack} playbackState={playbackState} />
          <TimeSlider />
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-1 sm:gap-2 w-[30%] justify-end">
          <QueueButton />
          <VolumeControls />
          <MobileMoreMenu />
          <FullscreenButton />
        </div>
      </div>
    </footer>
  );
}

// Loading skeleton for player bar
export function PlayerBarSkeleton() {
  return (
    <div className="h-[88px] bg-background border-t border-border">
      <div className="flex items-center h-full px-4 gap-4">
        <div className="flex items-center gap-3 w-[30%]">
          <Skeleton className="w-14 h-14 rounded-md" />
          <div className="space-y-2">
            <Skeleton className="w-24 h-4" />
            <Skeleton className="w-16 h-3" />
          </div>
        </div>
        <div className="flex-1 flex justify-center">
          <Skeleton className="w-32 h-10 rounded-full" />
        </div>
        <div className="w-[30%]" />
      </div>
    </div>
  );
}
