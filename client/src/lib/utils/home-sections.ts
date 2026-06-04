import {
  Clock,
  History,
  ListMusic,
  Play,
  Sparkles,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

export const homeSectionHrefs = {
  continueListening: "/home/continue-listening",
  mostPlayedRecently: "/home/most-played-recently",
  recentlyAdded: "/home/recently-added",
  forgottenFavorites: "/home/forgotten-favorites",
  discover: "/home/discover",
  similarTracks: "/home/similar-tracks",
};

export type HomeSectionKind =
  | "continueListening"
  | "mostPlayedRecently"
  | "recentlyAdded"
  | "forgottenFavorites"
  | "discover"
  | "similarTracks"
  | "topAlbums"
  | "recentAlbums"
  | "playlistSongs";

export type HomeSectionPlaylistType = "playlist" | "smartPlaylist";

export interface HomeSectionConfig {
  id: string;
  kind: HomeSectionKind;
  enabled: boolean;
  mostPlayedRecentlyDays?: number;
  forgottenFavoritesMinPlays?: number;
  forgottenFavoritesNotPlayedSinceDays?: number;
  topAlbumsDays?: number;
  playlistId?: string;
  playlistName?: string;
  playlistType?: HomeSectionPlaylistType;
}

export interface HomeSectionOption {
  kind: HomeSectionKind;
  label: string;
  description: string;
  icon: LucideIcon;
  href?: string;
  hasSettings?: boolean;
}

export interface HomeSectionPresentation {
  label: string;
  description: string;
  icon: LucideIcon;
  href?: string;
  hasSettings?: boolean;
  isConfigured: boolean;
}

export const DEFAULT_FORGOTTEN_FAVORITES_MIN_PLAYS = 10;
export const DEFAULT_FORGOTTEN_FAVORITES_NOT_PLAYED_DAYS = 90;
export const DEFAULT_MOST_PLAYED_RECENTLY_DAYS = 30;
export const DEFAULT_TOP_ALBUMS_DAYS = 90;

export const HOME_SECTION_OPTIONS: HomeSectionOption[] = [
  {
    kind: "continueListening",
    label: "Continue Listening",
    description: "Recent albums, playlists, and generated sources",
    icon: Play,
    href: homeSectionHrefs.continueListening,
  },
  {
    kind: "mostPlayedRecently",
    label: "Most Played Recently",
    description: "Tracks played most in a chosen recent period",
    icon: TrendingUp,
    href: homeSectionHrefs.mostPlayedRecently,
    hasSettings: true,
  },
  {
    kind: "recentlyAdded",
    label: "Recently Added",
    description: "Newly added albums",
    icon: Clock,
    href: homeSectionHrefs.recentlyAdded,
  },
  {
    kind: "forgottenFavorites",
    label: "Forgotten Favorites",
    description: "Older favorites worth revisiting",
    icon: History,
    href: homeSectionHrefs.forgottenFavorites,
    hasSettings: true,
  },
  {
    kind: "discover",
    label: "Discover Something New",
    description: "Random album discovery",
    icon: Sparkles,
    href: homeSectionHrefs.discover,
  },
  {
    kind: "similarTracks",
    label: "Similar To What You've Heard",
    description: "Tracks similar to your recent listening",
    icon: Sparkles,
    href: homeSectionHrefs.similarTracks,
  },
  {
    kind: "topAlbums",
    label: "Top Albums",
    description: "Albums played most in a chosen recent period",
    icon: TrendingUp,
    hasSettings: true,
  },
  {
    kind: "recentAlbums",
    label: "Recently Played Albums",
    description: "Albums ordered by last played time",
    icon: History,
  },
  {
    kind: "playlistSongs",
    label: "Playlist Songs",
    description: "Songs from a chosen playlist or smart playlist",
    icon: ListMusic,
    hasSettings: true,
  },
];

export const DEFAULT_HOME_SECTIONS: HomeSectionConfig[] = [
  { id: "continue-listening", kind: "continueListening", enabled: true },
  {
    id: "most-played-recently",
    kind: "mostPlayedRecently",
    enabled: true,
    mostPlayedRecentlyDays: DEFAULT_MOST_PLAYED_RECENTLY_DAYS,
  },
  { id: "recently-added", kind: "recentlyAdded", enabled: true },
  {
    id: "forgotten-favorites",
    kind: "forgottenFavorites",
    enabled: true,
    forgottenFavoritesMinPlays: DEFAULT_FORGOTTEN_FAVORITES_MIN_PLAYS,
    forgottenFavoritesNotPlayedSinceDays:
      DEFAULT_FORGOTTEN_FAVORITES_NOT_PLAYED_DAYS,
  },
  { id: "discover", kind: "discover", enabled: true },
  { id: "similar-tracks", kind: "similarTracks", enabled: true },
  {
    id: "top-albums",
    kind: "topAlbums",
    enabled: false,
    topAlbumsDays: DEFAULT_TOP_ALBUMS_DAYS,
  },
  { id: "recent-albums", kind: "recentAlbums", enabled: false },
];

const homeSectionKinds: readonly string[] = HOME_SECTION_OPTIONS.map(
  (option) => option.kind,
);

export function isHomeSectionKind(value: string): value is HomeSectionKind {
  return homeSectionKinds.includes(value);
}

export function getHomeSectionOption(kind: HomeSectionKind): HomeSectionOption {
  return (
    HOME_SECTION_OPTIONS.find((option) => option.kind === kind) ??
    HOME_SECTION_OPTIONS[0]
  );
}

function getDefaultHomeSection(kind: HomeSectionKind): HomeSectionConfig {
  return (
    DEFAULT_HOME_SECTIONS.find((section) => section.kind === kind) ?? {
      id: kind,
      kind,
      enabled: false,
    }
  );
}

export function createPlaylistHomeSectionConfig(
  config: Partial<HomeSectionConfig> = {},
): HomeSectionConfig {
  return {
    id: `playlist-songs-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    kind: "playlistSongs",
    enabled: true,
    ...config,
  };
}

export function normalizeHomeSections(
  value: HomeSectionConfig[],
): HomeSectionConfig[] {
  const normalized = value
    .filter((section) => isHomeSectionKind(section.kind))
    .map((section) => ({
      ...getDefaultHomeSection(section.kind),
      ...section,
    }));
  const configuredKinds = new Set(normalized.map((section) => section.kind));

  return [
    ...normalized,
    ...DEFAULT_HOME_SECTIONS.filter(
      (section) => !configuredKinds.has(section.kind),
    ),
  ];
}

export function getEnabledHomeSections(
  value: HomeSectionConfig[],
): HomeSectionConfig[] {
  return normalizeHomeSections(value).filter((section) => section.enabled);
}

export function getMostPlayedRecentlyDays(section?: HomeSectionConfig): number {
  return Math.max(
    1,
    section?.mostPlayedRecentlyDays ?? DEFAULT_MOST_PLAYED_RECENTLY_DAYS,
  );
}

export function getForgottenFavoritesMinPlays(
  section?: HomeSectionConfig,
): number {
  return Math.max(
    1,
    section?.forgottenFavoritesMinPlays ??
      DEFAULT_FORGOTTEN_FAVORITES_MIN_PLAYS,
  );
}

export function getForgottenFavoritesNotPlayedDays(
  section?: HomeSectionConfig,
): number {
  return Math.max(
    1,
    section?.forgottenFavoritesNotPlayedSinceDays ??
      DEFAULT_FORGOTTEN_FAVORITES_NOT_PLAYED_DAYS,
  );
}

export function getTopAlbumsDays(section?: HomeSectionConfig): number {
  return Math.max(1, section?.topAlbumsDays ?? DEFAULT_TOP_ALBUMS_DAYS);
}

function getDaysAgoIso(days: number) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  return { since: since.toISOString() };
}

export function getMostPlayedRecentlyFilters(
  days = DEFAULT_MOST_PLAYED_RECENTLY_DAYS,
) {
  return getDaysAgoIso(Math.max(1, days));
}

export function getTopAlbumsFilters(days = DEFAULT_TOP_ALBUMS_DAYS) {
  return getDaysAgoIso(Math.max(1, days));
}

export function getForgottenFavoritesFilters(section?: HomeSectionConfig) {
  return {
    minPlays: getForgottenFavoritesMinPlays(section),
    notPlayedSinceDays: getForgottenFavoritesNotPlayedDays(section),
  };
}

export function getHomeSectionQueueFilters(
  kind: HomeSectionKind,
  section?: HomeSectionConfig,
): Record<string, unknown> | undefined {
  switch (kind) {
    case "mostPlayedRecently":
      return getMostPlayedRecentlyFilters(getMostPlayedRecentlyDays(section));
    case "forgottenFavorites":
      return getForgottenFavoritesFilters(section);
    default:
      return undefined;
  }
}

export function getHomeSectionHref(
  section: HomeSectionConfig,
): string | undefined {
  if (section.kind === "playlistSongs") {
    if (!section.playlistId || !section.playlistType) {
      return undefined;
    }

    const encodedId = encodeURIComponent(section.playlistId);
    return section.playlistType === "smartPlaylist"
      ? `/playlists/smart?id=${encodedId}`
      : `/playlists/details?id=${encodedId}`;
  }

  const href = getHomeSectionOption(section.kind).href;
  if (!href) return undefined;

  if (section.kind === "mostPlayedRecently") {
    const params = new URLSearchParams({
      days: String(getMostPlayedRecentlyDays(section)),
    });
    return `${href}?${params.toString()}`;
  }

  if (section.kind === "forgottenFavorites") {
    const params = new URLSearchParams({
      minPlays: String(getForgottenFavoritesMinPlays(section)),
      notPlayedSinceDays: String(getForgottenFavoritesNotPlayedDays(section)),
    });
    return `${href}?${params.toString()}`;
  }

  return href;
}

export function getHomeSectionPresentation(
  section: HomeSectionConfig,
): HomeSectionPresentation {
  const option = getHomeSectionOption(section.kind);

  if (section.kind === "playlistSongs") {
    const isConfigured = Boolean(section.playlistId && section.playlistType);
    const isSmartPlaylist = section.playlistType === "smartPlaylist";

    return {
      label: section.playlistName || option.label,
      description: isConfigured
        ? isSmartPlaylist
          ? "Smart playlist songs"
          : "Playlist songs"
        : "Choose a playlist or smart playlist",
      icon: isSmartPlaylist ? Sparkles : ListMusic,
      href: getHomeSectionHref(section),
      hasSettings: true,
      isConfigured,
    };
  }

  return {
    label: option.label,
    description: option.description,
    icon: option.icon,
    href: getHomeSectionHref(section),
    hasSettings: option.hasSettings,
    isConfigured: true,
  };
}
