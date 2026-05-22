import type { QueueSourceType } from "@/lib/store/server-queue";
import { getMostPlayedRecentlyFilters } from "@/lib/utils/home-sections";

export interface ContinueListeningSourceDetails {
  queueSourceType: QueueSourceType;
  subtitle: string;
  coverType:
    | "playlist"
    | "song"
    | "favorites"
    | "mostPlayedRecently"
    | "discover"
    | "recentlyAdded"
    | "albumList";
  filters?: Record<string, unknown>;
}

function getAlbumListSourceDetails(
  sourceId: string | null | undefined,
): ContinueListeningSourceDetails {
  switch (sourceId) {
    case "random":
      return {
        queueSourceType: "albumList",
        subtitle: "Album discovery",
        coverType: "discover",
      };
    case "newest":
      return {
        queueSourceType: "albumList",
        subtitle: "Recently added albums",
        coverType: "recentlyAdded",
      };
    case "highest":
      return {
        queueSourceType: "albumList",
        subtitle: "Top rated albums",
        coverType: "albumList",
      };
    case "frequent":
      return {
        queueSourceType: "albumList",
        subtitle: "Frequently played albums",
        coverType: "albumList",
      };
    case "recent":
      return {
        queueSourceType: "albumList",
        subtitle: "Recently played albums",
        coverType: "recentlyAdded",
      };
    case "starred":
      return {
        queueSourceType: "albumList",
        subtitle: "Favorite albums",
        coverType: "favorites",
      };
    default:
      return {
        queueSourceType: "albumList",
        subtitle: "Album list",
        coverType: "albumList",
      };
  }
}

export function getContinueListeningSourceDetails(
  sourceType: string,
  sourceId?: string | null,
): ContinueListeningSourceDetails | null {
  switch (sourceType) {
    case "albumList":
      return getAlbumListSourceDetails(sourceId);
    case "favorites":
      return {
        queueSourceType: "favorites",
        subtitle: "Favorite songs",
        coverType: "favorites",
      };
    case "history":
      return {
        queueSourceType: "history",
        subtitle: "Listening history",
        coverType: "song",
      };
    case "songRadio":
      return {
        queueSourceType: "songRadio",
        subtitle: "Song Radio",
        coverType: "song",
      };
    case "forgottenFavorites":
      return {
        queueSourceType: "forgottenFavorites",
        subtitle: "Old favorites worth revisiting",
        coverType: "favorites",
      };
    case "mostPlayedRecently":
      return {
        queueSourceType: "mostPlayedRecently",
        subtitle: "Frequently played lately",
        coverType: "mostPlayedRecently",
        filters: getMostPlayedRecentlyFilters(),
      };
    default:
      return null;
  }
}
