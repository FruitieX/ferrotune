import type { Song } from "@/lib/api/types";

export function getPositiveFiniteDuration(
  duration: number | null | undefined,
): number {
  return typeof duration === "number" &&
    Number.isFinite(duration) &&
    duration > 0
    ? duration
    : 0;
}

export function getPlaybackDuration(
  song: Pick<Song, "duration"> | null | undefined,
  mediaDuration: number | null | undefined,
): number {
  return (
    getPositiveFiniteDuration(song?.duration) ||
    getPositiveFiniteDuration(mediaDuration)
  );
}
