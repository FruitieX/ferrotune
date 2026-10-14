import { atom, useAtom, useSetAtom } from "jotai";
import { atomFamily } from "jotai-family";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getClient } from "@/lib/api/client";
import {
  getStarredItemKey,
  invalidateFavoritesQueries,
  starredItemsAtom,
} from "@/lib/store/starred";
import { hapticStar, hapticUnstar } from "@/lib/utils/haptic";

/**
 * Repeatable song likes on top of favorites. Each tap adds a like; a tap
 * within this window of the newest like undoes it instead (the server's
 * `LIKE_UNDO_WINDOW`), so tapping repeatedly never piles up likes.
 */
export const LIKE_UNDO_WINDOW_MS = 12 * 60 * 60 * 1000;

export interface SongLikeState {
  likeCount: number;
  lastLiked: string | null;
}

/** Like state the server returned after a tap, newer than song DTOs fetched before it. */
const confirmedLikeAtomFamily = atomFamily((_songId: string) =>
  atom<SongLikeState | undefined>(undefined),
);

/** Whether the next like tap would undo the newest like. */
export function isRecentlyLiked(
  lastLiked: string | null | undefined,
  now = Date.now(),
): boolean {
  if (!lastLiked) return false;
  const likedAt = Date.parse(lastLiked);
  return Number.isFinite(likedAt) && now - likedAt < LIKE_UNDO_WINDOW_MS;
}

export interface LikeableSong {
  id: string;
  likeCount?: number | null;
  lastLiked?: string | null;
}

/** The song's like count, whether a tap would undo, and the tap itself. */
export function useSongLike(song: LikeableSong | null | undefined) {
  const songId = song?.id ?? "";
  const [confirmed, setConfirmed] = useAtom(confirmedLikeAtomFamily(songId));
  const setStarredItems = useSetAtom(starredItemsAtom);
  const queryClient = useQueryClient();

  const likeCount = confirmed?.likeCount ?? song?.likeCount ?? 0;
  const lastLiked = confirmed ? confirmed.lastLiked : (song?.lastLiked ?? null);
  const recentlyLiked = isRecentlyLiked(lastLiked);

  const toggleLike = async () => {
    const client = getClient();
    if (!client || !songId) return;
    if (recentlyLiked) hapticUnstar();
    else hapticStar();

    try {
      const result = await client.toggleSongLike(songId);
      setConfirmed({
        likeCount: result.likeCount,
        lastLiked: result.lastLiked,
      });
      // A like favorites the song; undoing that like unfavorites it again.
      setStarredItems((current) => {
        const updated = new Map(current);
        updated.set(getStarredItemKey("song", songId), result.starred != null);
        return updated;
      });
      invalidateFavoritesQueries(queryClient, "song");
      queryClient.invalidateQueries({ queryKey: ["most-liked"] });
      toast.success(
        result.liked
          ? result.likeCount === 1
            ? "Liked"
            : `Liked ${result.likeCount} times`
          : "Like removed",
      );
    } catch {
      toast.error("Failed to update likes");
    }
  };

  return { likeCount, recentlyLiked, toggleLike };
}
