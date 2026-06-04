import {
  AudioLines,
  Clock,
  Heart,
  History,
  ListMusic,
  Play,
  Shuffle,
  Sparkles,
  TrendingUp,
  User,
  type LucideIcon,
} from "lucide-react";
import type { QueueSourceType } from "@/lib/store/server-queue";
import {
  getHomeSectionHref,
  getHomeSectionQueueFilters,
  type HomeSectionConfig,
  homeSectionHrefs,
} from "@/lib/utils/home-sections";
import { getPlaylistDetailsHref } from "@/lib/utils/source-links";

export type HomeTileKind =
  | "favorites"
  | "history"
  | "forgottenFavorites"
  | "mostPlayedRecently"
  | "continueListening"
  | "recentlyAdded"
  | "discover"
  | "similarTracks"
  | "playlist"
  | "accountSwitch";

export type HomeTileActionMode = "open" | "play" | "shuffle";
export type HomeTilePlaylistType = "playlist" | "smartPlaylist";
export type HomeTileRequirement = "playlist" | "account";

export interface HomeTileConfig {
  id: string;
  kind: HomeTileKind;
  action?: HomeTileActionMode;
  playlistId?: string;
  playlistName?: string;
  playlistType?: HomeTilePlaylistType;
  accountKey?: string;
  accountLabel?: string;
}

export interface HomeTileOption {
  kind: HomeTileKind;
  label: string;
  description: string;
  icon: LucideIcon;
  requirement?: HomeTileRequirement;
  supportedActions?: HomeTileActionMode[];
}

export type HomeTileAction =
  | { type: "link"; href: string }
  | {
      type: "queue";
      sourceType: QueueSourceType;
      sourceId?: string;
      sourceName: string;
      shuffle: boolean;
      filters?: Record<string, unknown>;
    }
  | { type: "account"; accountKey?: string };

export interface HomeTilePresentation {
  id: string;
  label: string;
  subtitle: string;
  icon: LucideIcon;
  iconClassName: string;
  action: HomeTileAction;
  isIncomplete?: boolean;
}

export interface HomeTilePresentationOptions {
  homeSections?: HomeSectionConfig[];
}

export const DEFAULT_HOME_TILES: HomeTileConfig[] = [
  { id: "favorites", kind: "favorites", action: "open" },
  { id: "history", kind: "history", action: "open" },
];

export const HOME_TILE_OPTIONS: HomeTileOption[] = [
  {
    kind: "favorites",
    label: "Favorites",
    description: "Favorite songs, albums, and artists",
    icon: Heart,
  },
  {
    kind: "history",
    label: "Recently Played",
    description: "Listening history",
    icon: History,
  },
  {
    kind: "forgottenFavorites",
    label: "Forgotten Favorites",
    description: "Older favorites worth revisiting",
    icon: History,
  },
  {
    kind: "mostPlayedRecently",
    label: "Most Played Recently",
    description: "Tracks played most in the last month",
    icon: TrendingUp,
  },
  {
    kind: "continueListening",
    label: "Continue Listening",
    description: "Recent albums, playlists, and generated sources",
    icon: Play,
  },
  {
    kind: "recentlyAdded",
    label: "Recently Added",
    description: "Newly added albums",
    icon: Clock,
  },
  {
    kind: "discover",
    label: "Discover",
    description: "Random album discovery",
    icon: Sparkles,
  },
  {
    kind: "similarTracks",
    label: "Similar To What You've Heard",
    description: "Tracks similar to your recent listening",
    icon: AudioLines,
  },
  {
    kind: "playlist",
    label: "Playlist",
    description: "A chosen playlist or smart playlist",
    icon: ListMusic,
    requirement: "playlist",
  },
  {
    kind: "accountSwitch",
    label: "Switch Account",
    description: "Switch to a chosen saved account",
    icon: User,
    requirement: "account",
  },
];

const homeTileKinds: readonly string[] = HOME_TILE_OPTIONS.map(
  (option) => option.kind,
);

export function isHomeTileKind(value: string): value is HomeTileKind {
  return homeTileKinds.includes(value);
}

export function getHomeTileOption(kind: HomeTileKind): HomeTileOption {
  return (
    HOME_TILE_OPTIONS.find((option) => option.kind === kind) ??
    HOME_TILE_OPTIONS[0]
  );
}

export function getDefaultHomeTileAction(
  kind: HomeTileKind,
): HomeTileActionMode | undefined {
  return kind === "accountSwitch"
    ? undefined
    : kind === "playlist"
      ? "play"
      : "open";
}

export function getSupportedHomeTileActions(
  kind: HomeTileKind,
): HomeTileActionMode[] {
  return kind === "accountSwitch" ? [] : ["open", "play", "shuffle"];
}

export function createHomeTileConfig(
  kind: HomeTileKind,
  details: Omit<HomeTileConfig, "id" | "kind"> = {},
): HomeTileConfig {
  return {
    id: `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    action: getDefaultHomeTileAction(kind),
    ...details,
  };
}

export function normalizeHomeTiles(value: HomeTileConfig[]): HomeTileConfig[] {
  return value
    .map((tile) => migrateHomeTile(tile))
    .filter((tile): tile is HomeTileConfig => tile !== null);
}

function playbackTile(
  tile: HomeTileConfig,
  label: string,
  subtitle: string,
  icon: LucideIcon,
  iconClassName: string,
  action: Omit<Extract<HomeTileAction, { type: "queue" }>, "type">,
): HomeTilePresentation {
  return {
    id: tile.id,
    label,
    subtitle,
    icon,
    iconClassName,
    action: { type: "queue", ...action },
  };
}

function linkTile(
  tile: HomeTileConfig,
  label: string,
  subtitle: string,
  icon: LucideIcon,
  iconClassName: string,
  href: string,
): HomeTilePresentation {
  return {
    id: tile.id,
    label,
    subtitle,
    icon,
    iconClassName,
    action: { type: "link", href },
  };
}

type BaseTileDefinition = {
  label: string;
  actionTargetType: string;
  icon: LucideIcon;
  iconClassName: string;
  href: string;
  queue?: Omit<Extract<HomeTileAction, { type: "queue" }>, "type" | "shuffle">;
};

const baseTileDefinitions: Record<
  Exclude<HomeTileKind, "playlist" | "accountSwitch">,
  BaseTileDefinition
> = {
  favorites: {
    label: "Favorites",
    actionTargetType: "favorite songs",
    icon: Heart,
    iconClassName: "text-red-500",
    href: "/favorites",
    queue: { sourceType: "favorites", sourceName: "Favorites" },
  },
  history: {
    label: "Recently Played",
    actionTargetType: "listening history",
    icon: History,
    iconClassName: "text-sky-500",
    href: "/history",
    queue: { sourceType: "history", sourceName: "Recently Played" },
  },
  forgottenFavorites: {
    label: "Forgotten Favorites",
    actionTargetType: "favorite songs",
    icon: History,
    iconClassName: "text-amber-500",
    href: homeSectionHrefs.forgottenFavorites,
    queue: {
      sourceType: "forgottenFavorites",
      sourceName: "Forgotten Favorites",
    },
  },
  mostPlayedRecently: {
    label: "Most Played Recently",
    actionTargetType: "tracks",
    icon: TrendingUp,
    iconClassName: "text-rose-500",
    href: homeSectionHrefs.mostPlayedRecently,
    queue: {
      sourceType: "mostPlayedRecently",
      sourceName: "Most Played Recently",
    },
  },
  continueListening: {
    label: "Continue Listening",
    actionTargetType: "sources",
    icon: Play,
    iconClassName: "text-emerald-500",
    href: homeSectionHrefs.continueListening,
    queue: {
      sourceType: "continueListening",
      sourceName: "Continue Listening",
    },
  },
  recentlyAdded: {
    label: "Recently Added",
    actionTargetType: "albums",
    icon: Clock,
    iconClassName: "text-sky-500",
    href: homeSectionHrefs.recentlyAdded,
    queue: {
      sourceType: "albumList",
      sourceId: "newest",
      sourceName: "Recently Added",
    },
  },
  discover: {
    label: "Discover",
    actionTargetType: "albums",
    icon: Sparkles,
    iconClassName: "text-violet-500",
    href: homeSectionHrefs.discover,
    queue: {
      sourceType: "albumList",
      sourceId: "random",
      sourceName: "Discover",
    },
  },
  similarTracks: {
    label: "Similar To What You've Heard",
    actionTargetType: "songs",
    icon: AudioLines,
    iconClassName: "text-emerald-500",
    href: homeSectionHrefs.similarTracks,
    queue: {
      sourceType: "similarTracks",
      sourceName: "Similar To What You've Heard",
    },
  },
};

function actionSubtitle(action: HomeTileActionMode, target: string): string {
  switch (action) {
    case "play":
      return `Play ${target}`;
    case "shuffle":
      return `Shuffle ${target}`;
    case "open":
      return `Open ${target}`;
  }
}

function getSectionConfigForTile(
  kind: Exclude<HomeTileKind, "playlist" | "accountSwitch">,
  homeSections?: HomeSectionConfig[],
): HomeSectionConfig | undefined {
  switch (kind) {
    case "continueListening":
    case "mostPlayedRecently":
    case "recentlyAdded":
    case "forgottenFavorites":
    case "discover":
      return homeSections?.find((section) => section.kind === kind);
    default:
      return undefined;
  }
}

function getQueueFiltersForTile(
  kind: Exclude<HomeTileKind, "playlist" | "accountSwitch">,
  section?: HomeSectionConfig,
): Record<string, unknown> | undefined {
  switch (kind) {
    case "mostPlayedRecently":
    case "forgottenFavorites":
      return getHomeSectionQueueFilters(kind, section);
    default:
      return undefined;
  }
}

function migrateHomeTile(tile: HomeTileConfig): HomeTileConfig | null {
  if (isHomeTileKind(tile.kind)) {
    return {
      ...tile,
      action: tile.action ?? getDefaultHomeTileAction(tile.kind),
    };
  }

  const oldKind = tile.kind as string;
  const legacyMap: Record<string, Pick<HomeTileConfig, "kind" | "action">> = {
    favoritesLink: { kind: "favorites", action: "open" },
    historyLink: { kind: "history", action: "open" },
    forgottenFavoritesLink: { kind: "forgottenFavorites", action: "open" },
    mostPlayedRecentlyLink: { kind: "mostPlayedRecently", action: "open" },
    continueListeningLink: { kind: "continueListening", action: "open" },
    recentlyAddedLink: { kind: "recentlyAdded", action: "open" },
    discoverLink: { kind: "discover", action: "open" },
    favoritesPlay: { kind: "favorites", action: "play" },
    favoritesShuffle: { kind: "favorites", action: "shuffle" },
    forgottenFavoritesPlay: { kind: "forgottenFavorites", action: "play" },
    forgottenFavoritesShuffle: {
      kind: "forgottenFavorites",
      action: "shuffle",
    },
    mostPlayedRecentlyPlay: { kind: "mostPlayedRecently", action: "play" },
    mostPlayedRecentlyShuffle: {
      kind: "mostPlayedRecently",
      action: "shuffle",
    },
    continueListeningPlay: { kind: "continueListening", action: "play" },
    continueListeningShuffle: {
      kind: "continueListening",
      action: "shuffle",
    },
    recentlyAddedShuffle: { kind: "recentlyAdded", action: "shuffle" },
    discoverShuffle: { kind: "discover", action: "shuffle" },
    playlistPlay: { kind: "playlist", action: "play" },
    playlistShuffle: { kind: "playlist", action: "shuffle" },
  };
  const migrated = legacyMap[oldKind];
  return migrated ? { ...tile, ...migrated } : null;
}

export function getHomeTilePresentation(
  tile: HomeTileConfig,
  options: HomeTilePresentationOptions = {},
): HomeTilePresentation {
  const action = tile.action ?? getDefaultHomeTileAction(tile.kind) ?? "open";

  if (tile.kind !== "playlist" && tile.kind !== "accountSwitch") {
    const definition = baseTileDefinitions[tile.kind];
    const section = getSectionConfigForTile(tile.kind, options.homeSections);
    const href = section
      ? (getHomeSectionHref(section) ?? definition.href)
      : definition.href;
    const filters = getQueueFiltersForTile(tile.kind, section);
    if (action === "open" || !definition.queue) {
      return linkTile(
        tile,
        definition.label,
        actionSubtitle("open", definition.actionTargetType),
        definition.icon,
        definition.iconClassName,
        href,
      );
    }

    return playbackTile(
      tile,
      definition.label,
      actionSubtitle(action, definition.actionTargetType),
      action === "shuffle" ? Shuffle : Play,
      definition.iconClassName,
      {
        ...definition.queue,
        shuffle: action === "shuffle",
        filters,
      },
    );
  }

  switch (tile.kind) {
    case "playlist": {
      const shuffle = action === "shuffle";
      const playlistName = tile.playlistName ?? "Choose playlist";
      const playlistTypeLabel =
        tile.playlistType === "smartPlaylist" ? "smart playlist" : "playlist";
      const isIncomplete = !tile.playlistId || !tile.playlistType;
      if (action === "open") {
        return {
          ...linkTile(
            tile,
            playlistName,
            actionSubtitle("open", playlistTypeLabel),
            ListMusic,
            tile.playlistType === "smartPlaylist"
              ? "text-violet-500"
              : "text-cyan-500",
            tile.playlistId && tile.playlistType
              ? getPlaylistDetailsHref(tile.playlistType, tile.playlistId)
              : "#",
          ),
          isIncomplete,
        };
      }

      const presentation = playbackTile(
        tile,
        playlistName,
        actionSubtitle(action, playlistTypeLabel),
        shuffle ? Shuffle : ListMusic,
        tile.playlistType === "smartPlaylist"
          ? "text-violet-500"
          : "text-cyan-500",
        {
          sourceType: tile.playlistType ?? "playlist",
          sourceId: tile.playlistId,
          sourceName: playlistName,
          shuffle,
        },
      );
      return { ...presentation, isIncomplete };
    }
    case "accountSwitch":
      return {
        id: tile.id,
        label: tile.accountLabel ?? "Choose account",
        subtitle: "Switch to account",
        icon: User,
        iconClassName: "text-lime-500",
        action: { type: "account", accountKey: tile.accountKey },
        isIncomplete: !tile.accountKey,
      };
  }
}
