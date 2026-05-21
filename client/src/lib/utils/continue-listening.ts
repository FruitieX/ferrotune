import type { QueueSourceType } from "@/lib/store/server-queue";

export interface ContinueListeningSourceDetails {
  queueSourceType: QueueSourceType;
  subtitle: string;
  coverType: "playlist" | "song";
}

export function getContinueListeningSourceDetails(
  sourceType: string,
): ContinueListeningSourceDetails | null {
  switch (sourceType) {
    case "favorites":
      return {
        queueSourceType: "favorites",
        subtitle: "Favorite songs",
        coverType: "playlist",
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
    default:
      return null;
  }
}
