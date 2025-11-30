"use client";

import { useState, useEffect } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { toast } from "sonner";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import { currentTrackAtom } from "@/lib/store/queue";
import { queuePanelOpenAtom, fullscreenPlayerOpenAtom } from "@/lib/store/ui";
import { serverConnectionAtom } from "@/lib/store/auth";
import { formatDuration } from "@/lib/utils/format";
import { getClient } from "@/lib/api/client";

export function PlayerBar() {
  const currentTrack = useAtomValue(currentTrackAtom);
  const currentTime = useAtomValue(currentTimeAtom);
  const duration = useAtomValue(durationAtom);
  const playbackState = useAtomValue(playbackStateAtom);
  const connection = useAtomValue(serverConnectionAtom);
  const setQueuePanelOpen = useSetAtom(queuePanelOpenAtom);
  const [isStarred, setIsStarred] = useState(false);

  // Sync starred state when track changes
  useEffect(() => {
    setIsStarred(!!currentTrack?.starred);
  }, [currentTrack?.id, currentTrack?.starred]);

  const handleStar = async () => {
    const client = getClient();
    if (!client || !currentTrack) return;

    try {
      if (isStarred) {
        await client.unstar({ id: currentTrack.id });
        setIsStarred(false);
        toast.success("Removed from favorites");
      } else {
        await client.star({ id: currentTrack.id });
        setIsStarred(true);
        toast.success("Added to favorites");
      }
    } catch (error) {
      toast.error("Failed to update favorites");
      console.error(error);
    }
  };
  const setFullscreenOpen = useSetAtom(fullscreenPlayerOpenAtom);

  const { togglePlayPause, next, previous, seekPercent } = useAudioEngine();
  const { volume, isMuted, toggleMute, changeVolume } = useVolumeControl();
  const { repeatMode, cycleRepeatMode } = useRepeatMode();
  const { isShuffled, toggleShuffle } = useShuffle();

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const isPlaying = playbackState === "playing";
  const isLoading = playbackState === "loading";

  // Get cover art URL
  const coverArtUrl = currentTrack?.coverArt
    ? getClient()?.getCoverArtUrl(currentTrack.coverArt, 96)
    : null;

  // Volume icon based on level
  const VolumeIcon = isMuted || volume === 0 
    ? VolumeX 
    : volume < 0.5 
      ? Volume1 
      : Volume2;

  // Repeat icon based on mode
  const RepeatIcon = repeatMode === "one" ? Repeat1 : Repeat;

  if (!connection) {
    return null;
  }

  return (
    <footer
      data-testid="player-bar"
      className={cn(
        "z-50 lg:ml-[280px]",
        "h-[88px] bg-background/95 backdrop-blur-lg border-t border-border",
        "transition-all duration-200"
      )}
    >
      {/* Progress bar (thin line at top) */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-muted group cursor-pointer"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const percent = ((e.clientX - rect.left) / rect.width) * 100;
          seekPercent(percent);
        }}
      >
        <motion.div
          className="h-full bg-primary"
          style={{ width: `${progress}%` }}
        />
        <div className="absolute top-0 left-0 right-0 h-3 -translate-y-1 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>

      <div className="flex items-center h-full px-4 gap-4">
        {/* Now Playing Info */}
        <div className="flex items-center gap-3 w-[30%] min-w-0">
          {currentTrack ? (
            <>
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="relative w-14 h-14 rounded-md overflow-hidden bg-muted shrink-0 album-glow"
              >
                {coverArtUrl ? (
                  <Image
                    src={coverArtUrl}
                    alt={currentTrack.album}
                    fill
                    className="object-cover"
                    unoptimized
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-muted">
                    <ListMusic className="w-6 h-6 text-muted-foreground" />
                  </div>
                )}
              </motion.div>
              <div className="min-w-0">
                <Link
                  href={`/library/albums/${currentTrack.albumId}`}
                  className="block text-sm font-medium text-foreground truncate hover:underline"
                >
                  {currentTrack.title}
                </Link>
                <Link
                  href={`/library/artists/${currentTrack.artistId}`}
                  className="block text-xs text-muted-foreground truncate hover:underline"
                >
                  {currentTrack.artist}
                </Link>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="hidden sm:flex shrink-0 h-8 w-8"
                onClick={handleStar}
              >
                <Heart className={cn("w-4 h-4", isStarred && "fill-red-500 text-red-500")} />
              </Button>
            </>
          ) : (
            <div className="flex items-center gap-3">
              <div className="w-14 h-14 rounded-md bg-muted" />
              <div>
                <p className="text-sm text-muted-foreground">Not playing</p>
              </div>
            </div>
          )}
        </div>

        {/* Center Controls */}
        <div className="flex flex-col items-center gap-1 flex-1 max-w-[40%]">
          <div className="flex items-center gap-1 sm:gap-2">
            {/* Shuffle - hidden on mobile, shown in more menu */}
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "hidden sm:flex h-8 w-8",
                isShuffled && "text-primary"
              )}
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
              disabled={!currentTrack}
              aria-label="Previous"
            >
              <SkipBack className="w-4 h-4 sm:w-5 sm:h-5" />
            </Button>

            <Button
              variant="default"
              size="icon"
              className="h-9 w-9 sm:h-10 sm:w-10 rounded-full"
              onClick={togglePlayPause}
              disabled={!currentTrack && playbackState === "idle"}
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
              disabled={!currentTrack}
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
                repeatMode !== "off" && "text-primary"
              )}
              onClick={cycleRepeatMode}
              aria-label="Repeat"
            >
              <RepeatIcon className="w-4 h-4" />
            </Button>
          </div>

          {/* Time display - hidden on mobile */}
          <div className="hidden sm:flex items-center gap-2 w-full max-w-md text-xs text-muted-foreground">
            <span className="w-10 text-right tabular-nums">
              {formatDuration(currentTime)}
            </span>
            <Slider
              value={[progress]}
              max={100}
              step={0.1}
              className="flex-1"
              onValueChange={([value]) => seekPercent(value)}
            />
            <span className="w-10 tabular-nums">
              {formatDuration(duration)}
            </span>
          </div>
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-1 sm:gap-2 w-[30%] justify-end">
          {/* Queue button - always visible */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setQueuePanelOpen(true)}
            aria-label="Queue"
          >
            <ListMusic className="w-4 h-4" />
          </Button>

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
            <PopoverContent 
              side="top" 
              align="center" 
              className="w-auto p-3"
            >
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
          <div className="hidden sm:flex items-center gap-2 w-32">
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

          {/* More options on mobile - contains shuffle, repeat, fullscreen */}
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
            <PopoverContent 
              side="top" 
              align="end" 
              className="w-auto p-2"
            >
              <div className="flex flex-col gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "justify-start gap-2",
                    isShuffled && "text-primary"
                  )}
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
                    repeatMode !== "off" && "text-primary"
                  )}
                  onClick={cycleRepeatMode}
                >
                  <RepeatIcon className="w-4 h-4" />
                  Repeat {repeatMode === "one" ? "One" : repeatMode === "all" ? "All" : "Off"}
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

          {/* Fullscreen - desktop only */}
          <Button
            variant="ghost"
            size="icon"
            className="hidden sm:flex h-8 w-8"
            onClick={() => setFullscreenOpen(true)}
            aria-label="Fullscreen"
          >
            <Maximize2 className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </footer>
  );
}

// Loading skeleton for player bar
export function PlayerBarSkeleton() {
  return (
    <div className="h-[88px] bg-background border-t border-border lg:ml-[280px]">
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
