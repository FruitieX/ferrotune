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
  // Ferrotune extensions for play statistics
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
