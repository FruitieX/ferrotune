import { HeartPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type LikeableSong, useSongLike } from "@/lib/store/likes";
import { cn } from "@/lib/utils";

interface LikeButtonProps {
  song: LikeableSong;
  className?: string;
  iconClassName?: string;
}

/**
 * The like counter beside the favorite heart: each tap likes the song again,
 * and a tap within 12 hours of the newest like takes it back.
 */
export function LikeButton({
  song,
  className,
  iconClassName,
}: LikeButtonProps) {
  const { likeCount, recentlyLiked, toggleLike } = useSongLike(song);
  const label = recentlyLiked
    ? "Undo like"
    : likeCount > 0
      ? "Like again"
      : "Like";

  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={label}
      aria-pressed={recentlyLiked}
      title={
        recentlyLiked
          ? `${likeCount} ${likeCount === 1 ? "like" : "likes"}, tap again to undo`
          : `${likeCount} ${likeCount === 1 ? "like" : "likes"}`
      }
      data-testid="like-button"
      className={cn("shrink-0 gap-1 px-2", className)}
      onClick={() => {
        // toggleLike fires its own haptic pattern
        toggleLike();
      }}
    >
      <HeartPlus
        className={cn(
          "w-4 h-4",
          iconClassName,
          recentlyLiked && "text-red-500",
        )}
      />
      {likeCount > 0 && (
        <span
          data-testid="like-count"
          className={cn(
            "text-xs tabular-nums",
            recentlyLiked ? "text-red-500" : "text-muted-foreground",
          )}
        >
          {likeCount}
        </span>
      )}
    </Button>
  );
}
