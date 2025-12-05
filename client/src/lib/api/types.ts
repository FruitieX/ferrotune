// OpenSubsonic API Response Types

// Base response wrapper
export interface SubsonicResponse<T = unknown> {
  "subsonic-response": {
    status: "ok" | "failed";
    version: string;
    type: string;
    serverVersion: string;
    openSubsonic: boolean;
    error?: SubsonicError;
  } & T;
}

export interface SubsonicError {
  code: number;
  message: string;
}

// Music entities
export interface Artist {
  id: string;
  name: string;
  albumCount: number;
  coverArt?: string;
  starred?: string;
  userRating?: number;
}

export interface ArtistWithAlbums extends Artist {
  album: Album[];
  song?: Song[];  // Songs by this artist (track artist), includes songs on compilations
}

export interface ArtistIndex {
  name: string;
  artist: Artist[];
}

export interface Album {
  id: string;
  name: string;
  artist: string;
  artistId: string;
  coverArt?: string;
  songCount: number;
  duration: number;
  year?: number;
  genre?: string;
  created: string;
  starred?: string;
  userRating?: number;
}

export interface AlbumWithSongs extends Album {
  song: Song[];
}

export interface Song {
  id: string;
  title: string;
  album: string;
  albumId: string;
  artist: string;
  artistId: string;
  track?: number;
  discNumber?: number;
  year?: number;
  genre?: string;
  coverArt?: string;
  size: number;
  contentType: string;
  suffix: string;
  duration: number;
  bitRate?: number;
  path: string;
  starred?: string;
  userRating?: number;
  created: string;
  type: "music";
  // Ferrotune extensions
  /** Full filesystem path (only available from getSong endpoint) */
  fullPath?: string;
  playCount?: number;
  lastPlayed?: string;
}

export interface Genre {
  songCount: number;
  albumCount: number;
  value: string;
}

export interface MusicFolder {
  id: number;
  name: string;
}

export interface Playlist {
  id: string;
  name: string;
  comment?: string;
  owner?: string;
  public?: boolean;
  songCount: number;
  duration: number;
  created: string;
  changed?: string;
  coverArt?: string;
}

export interface PlaylistWithSongs extends Playlist {
  entry: Song[];
}

// Response payloads
export interface PingResponse {
  // Empty for ping
}

export interface LicenseResponse {
  license: {
    valid: boolean;
    email?: string;
    licenseExpires?: string;
  };
}

export interface MusicFoldersResponse {
  musicFolders: {
    musicFolder: MusicFolder[];
  };
}

export interface ArtistsResponse {
  artists: {
    index: ArtistIndex[];
  };
}

export interface ArtistResponse {
  artist: ArtistWithAlbums;
}

export interface AlbumResponse {
  album: AlbumWithSongs;
}

export interface SongResponse {
  song: Song;
}

export interface GenresResponse {
  genres: {
    genre: Genre[];
  };
}

export interface AlbumListResponse {
  albumList2: {
    album: Album[];
    /** Total count of albums (Ferrotune extension for pagination) */
    total?: number;
  };
}

export interface RandomSongsResponse {
  randomSongs: {
    song: Song[];
  };
}

export interface SongsByGenreResponse {
  songsByGenre: {
    song?: Song[];
  };
}

export interface SearchResponse {
  searchResult3: {
    artist?: Artist[];
    album?: Album[];
    song?: Song[];
    /** Total count of matching artists (Ferrotune extension for pagination) */
    artistTotal?: number;
    /** Total count of matching albums (Ferrotune extension for pagination) */
    albumTotal?: number;
    /** Total count of matching songs (Ferrotune extension for pagination) */
    songTotal?: number;
  };
}

export interface StarredResponse {
  starred2: {
    artist?: Artist[];
    album?: Album[];
    song?: Song[];
  };
}

export interface PlaylistsResponse {
  playlists: {
    playlist: Playlist[];
  };
}

export interface PlaylistResponse {
  playlist: PlaylistWithSongs;
}

// Play Queue types
export interface PlayQueueEntry extends Song {
  // Song with play queue context
}

export interface PlayQueue {
  entry: PlayQueueEntry[];
  current?: string;
  position?: number;
  username?: string;
  changed?: string;
  changedBy?: string;
}

export interface PlayQueueResponse {
  playQueue: PlayQueue;
}

// Play History types (Ferrotune extension)
export interface PlayHistoryEntry extends Song {
  playedAt: string;
}

export interface PlayHistoryResponse {
  playHistory: {
    entry: PlayHistoryEntry[];
    total?: number;
  };
}

// Album list types
export type AlbumListType =
  | "random"
  | "newest"
  | "highest"
  | "frequent"
  | "recent"
  | "starred"
  | "alphabeticalByName"
  | "alphabeticalByArtist"
  | "byYear"
  | "byGenre";

// API Parameters
export interface AlbumListParams {
  type: AlbumListType;
  size?: number;
  offset?: number;
  fromYear?: number;
  toYear?: number;
  genre?: string;
  musicFolderId?: number;
}

export interface SearchParams {
  query: string;
  artistCount?: number;
  artistOffset?: number;
  albumCount?: number;
  albumOffset?: number;
  songCount?: number;
  songOffset?: number;
  /** Ferrotune extension: sort field for songs (name, artist, album, year, duration, playCount, dateAdded) */
  songSort?: string;
  /** Ferrotune extension: sort direction (asc, desc) */
  songSortDir?: string;
  /** Ferrotune extension: sort field for albums (name, artist, year, dateAdded) */
  albumSort?: string;
  /** Ferrotune extension: sort direction for albums (asc, desc) */
  albumSortDir?: string;
  // ===== Advanced Filter Parameters (Ferrotune extension) =====
  /** Filter songs/albums by minimum year */
  minYear?: number;
  /** Filter songs/albums by maximum year */
  maxYear?: number;
  /** Filter songs/albums by genre (exact match) */
  genre?: string;
  /** Filter songs by minimum duration in seconds */
  minDuration?: number;
  /** Filter songs by maximum duration in seconds */
  maxDuration?: number;
  /** Filter songs/albums by minimum user rating (1-5) */
  minRating?: number;
  /** Filter songs/albums by maximum user rating (1-5) */
  maxRating?: number;
  /** Filter to only starred items */
  starredOnly?: boolean;
  /** Filter songs by minimum play count */
  minPlayCount?: number;
  /** Filter songs by maximum play count */
  maxPlayCount?: number;
  /** Filter to only shuffle-excluded songs */
  shuffleExcludedOnly?: boolean;
  /** Filter songs by minimum bitrate in kbps */
  minBitrate?: number;
  /** Filter songs by maximum bitrate in kbps */
  maxBitrate?: number;
  /** Filter songs added after this date (ISO 8601: YYYY-MM-DD) */
  addedAfter?: string;
  /** Filter songs added before this date (ISO 8601: YYYY-MM-DD) */
  addedBefore?: string;
}

export interface RandomSongsParams {
  size?: number;
  genre?: string;
  fromYear?: number;
  toYear?: number;
  musicFolderId?: number;
}

export interface SongsByGenreParams {
  count?: number;
  offset?: number;
  musicFolderId?: number;
}

// Connection settings
export interface ServerConnection {
  serverUrl: string;
  apiKey?: string;
  username?: string;
  password?: string;
}

// Tag editing types (Admin API)
export interface TagEntry {
  key: string;
  value: string;
}

export interface AdditionalTagBlock {
  tagType: string;
  tags: TagEntry[];
}

export interface GetTagsResponse {
  id: string;
  filePath: string;
  fileFormat: string;
  editingEnabled: boolean;
  tagType?: string;
  tags: TagEntry[];
  additionalTags?: AdditionalTagBlock[];
}

export interface UpdateTagsRequest {
  set?: TagEntry[];
  delete?: string[];
}

export interface TagChange {
  key: string;
  action: "set" | "deleted";
  oldValue?: string;
  newValue?: string;
}

export interface UpdateTagsResponse {
  success: boolean;
  message: string;
  changes: TagChange[];
  rescanRecommended: boolean;
}

// Server statistics types (Admin API)
export interface ServerStats {
  songCount: number;
  albumCount: number;
  artistCount: number;
  genreCount: number;
  playlistCount: number;
  totalDurationSeconds: number;
  totalSizeBytes: number;
  totalPlays: number;
}

// User preferences types (Admin API)
export interface UserPreferences {
  accentColor: string;
  customAccentHue?: number;
  customAccentLightness?: number;
  customAccentChroma?: number;
}

export interface UpdatePreferencesRequest {
  accentColor: string;
  customAccentHue?: number;
  customAccentLightness?: number;
  customAccentChroma?: number;
}

// Listening statistics types (Admin API)
export interface ListeningStats {
  totalSeconds: number;
  sessionCount: number;
  uniqueSongs: number;
}

export interface ListeningStatsResponse {
  last7Days: ListeningStats;
  last30Days: ListeningStats;
  thisYear: ListeningStats;
  allTime: ListeningStats;
}
