import {
  Clock,
  History,
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
};

export type HomeSectionKind =
  | "continueListening"
  | "mostPlayedRecently"
  | "recentlyAdded"
  | "forgottenFavorites"
  | "discover"
  | "topAlbums"
  | "recentAlbums";

export interface HomeSectionConfig {
  id: string;
  kind: HomeSectionKind;
  enabled: boolean;
  mostPlayedRecentlyDays?: number;
  forgottenFavoritesMinPlays?: number;
  forgottenFavoritesNotPlayedSinceDays?: number;
  topAlbumsDays?: number;
}

export interface HomeSectionOption {
  kind: HomeSectionKind;
  label: string;
  description: string;
  icon: LucideIcon;
  href?: string;
  hasSettings?: boolean;
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
    DEFAULT_HOME_SECTIONS.find((section) => section.kind === kind) ??
    DEFAULT_HOME_SECTIONS[0]
  );
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
