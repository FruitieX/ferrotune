// API response types
// Re-exports generated types from ts-rs with client-friendly type aliases
//
// NAMING CONVENTION:
// - Entity types (Song, Album, Artist, Genre, Playlist) = base data objects
// - *Response types = API response wrappers (e.g., { artist: ... }, { album: ... })
// - *WithSongs / *WithAlbums = entities with nested child data
//
// The generated types use a different naming:
// - SongResponse, AlbumResponse, ArtistResponse = entity types
// - AlbumDetailResponse = { album: AlbumDetail } (wrapper)
// - AlbumDetail = album entity with songs
//
// We re-export with aliases to match client expectations.

import type {
  AlbumListType as _AlbumListType,
  AlbumResponse as _AlbumResponse,
  ArtistResponse as _ArtistResponse,
  FerrotuneAlbumListResponse as _FerrotuneAlbumListResponse,
  FerrotuneAlbumResponse as _FerrotuneAlbumResponse,
  FerrotuneArtistResponse as _FerrotuneArtistResponse,
  FerrotuneArtistsResponse as _FerrotuneArtistsResponse,
  FerrotuneGenresResponse as _FerrotuneGenresResponse,
  FerrotuneIndexesResponse as _FerrotuneIndexesResponse,
  FerrotunePlayHistoryEntry as _FerrotunePlayHistoryEntry,
  FerrotunePlayHistoryResponse as _FerrotunePlayHistoryResponse,
  FerrotuneRandomSongsResponse as _FerrotuneRandomSongsResponse,
  FerrotuneSearchContent as _FerrotuneSearchContent,
  FerrotuneSimilarSongsResponse as _FerrotuneSimilarSongsResponse,
  FerrotuneSongResponse as _FerrotuneSongResponse,
  FerrotuneSongsByGenreResponse as _FerrotuneSongsByGenreResponse,
  FerrotuneStarredResponse as _FerrotuneStarredResponse,
  IndexesData as _IndexesData,
  MusicFolderInfo as _MusicFolderInfo,
  MusicFoldersResponse as _GeneratedMusicFoldersResponse,
  PlaylistSongsResponse as _PlaylistSongsResponse,
  SongResponse as _SongResponse,
} from "./generated";

// ============================================================================
// Core Entity Types - Base data objects without nested data
// ============================================================================

// Song entity (generated SongResponse = entity, not a wrapper)
export type { SongResponse } from "./generated";
export type { SongResponse as Song } from "./generated";

// Album entity (generated AlbumResponse = entity, not a wrapper)
export type { AlbumResponse } from "./generated";
export type { AlbumResponse as Album } from "./generated";

// Artist entity (generated ArtistResponse = entity, not a wrapper)
export type { ArtistResponse } from "./generated";
export type { ArtistResponse as Artist } from "./generated";

// Genre entity
export type { GenreResponse } from "./generated";
export type { GenreResponse as Genre } from "./generated";

// Playlist entity. The native folder listing returns a compact playlist shape,
// while much of the client still expects the older playlist metadata shape.
export type PlaylistResponse = {
  id: string;
  name: string;
  comment: string | null;
  owner: string;
  public: boolean;
  songCount: number;
  duration: number;
  created: string;
  changed: string;
  coverArt: string | null;
};
export type Playlist = PlaylistResponse;

// Smart playlist entity
export type { SmartPlaylistsResponse } from "./generated";
export type { SmartPlaylistInfo as SmartPlaylist } from "./generated";

// Music folder entity
export type MusicFolderResponse = _MusicFolderInfo;
export type MusicFolder = _MusicFolderInfo;

// ============================================================================
// Extended Entity Types - Entities with nested child data
// ============================================================================

// Album with its songs (for album detail pages)
export type { AlbumDetail } from "./generated";
export type { AlbumDetail as AlbumWithSongs } from "./generated";

// Artist with albums and songs (for artist detail pages)
export type { ArtistDetail } from "./generated";
export type { ArtistDetail as ArtistWithAlbums } from "./generated";

// Playlist with its songs (for playlist detail pages)
export type PlaylistDetailResponse = _PlaylistSongsResponse;
export type PlaylistWithSongs = _PlaylistSongsResponse;

// ============================================================================
// API Response Wrapper Types - What the endpoints actually return
// ============================================================================

// getArtists response: { artists: { index: [...] } }
export type ArtistsResponse = _FerrotuneArtistsResponse;
export type { ArtistsIndex } from "./generated";
export type { ArtistIndex } from "./generated";

// getArtist response: { artist: ArtistDetail }
// NOTE: This is what getArtist() returns - wrapper with detail
export type ArtistDetailResponse = _FerrotuneArtistResponse;
// Client alias: ArtistResponse used to mean the wrapper
export type ArtistResponse_Wrapper = ArtistDetailResponse;

// getAlbum response: { album: AlbumDetail }
export type AlbumDetailResponse = _FerrotuneAlbumResponse;
// Client alias: AlbumResponse used to mean the wrapper
export type AlbumResponse_Wrapper = AlbumDetailResponse;

// getSong response: { song: SongResponse }
export type SongDetailResponse = _FerrotuneSongResponse;
export type SongResponse_Wrapper = SongDetailResponse;

// getGenres response: { genres: { genre: [...] } }
export type GenresResponse = _FerrotuneGenresResponse;

// getAlbumList2 response
export type AlbumList2Content = {
  album: _FerrotuneAlbumListResponse["album"];
  total?: number;
  seed?: number;
};
export type AlbumList2Response = { albumList2: AlbumList2Content };
// Client alias with seed extension
export type AlbumListResponse = {
  albumList2: AlbumList2Content;
};

// getRandomSongs response
export type RandomSongsResponse = _FerrotuneRandomSongsResponse;

// getSongsByGenre response
export type SongsByGenreResponse = {
  songsByGenre: { song: _FerrotuneSongsByGenreResponse["song"] };
};

// getForgottenFavorites response
export type { ForgottenFavoritesResponse } from "./generated";

// getMostPlayedRecently response
export type { MostPlayedRecentlyResponse } from "./generated";

// search response, adapted to the legacy client-side `searchResult3` shape
export type SearchContent = Omit<
  _FerrotuneSearchContent,
  "artistTotal" | "albumTotal" | "songTotal"
> & {
  artistTotal?: number;
  albumTotal?: number;
  songTotal?: number;
};
export type SearchResult3 = { searchResult3: SearchContent };
// Client alias for backward compat
export type SearchResponse = SearchResult3;

// getStarred response
export type Starred2Content = {
  artist: _FerrotuneStarredResponse["artists"];
  album: _FerrotuneStarredResponse["albums"];
  song: _FerrotuneStarredResponse["songs"];
};
export type Starred2Response = { starred2: Starred2Content };
export type StarredResponse = _FerrotuneStarredResponse;

// getPlaylists response
export type PlaylistsResponse = { playlists: { playlist: PlaylistResponse[] } };

// getPlaylist response: { playlist: PlaylistDetail }
export type PlaylistWithSongsResponse = {
  playlist: PlaylistResponse & { entry: _SongResponse[] };
};
export type PlaylistResponse_Wrapper = PlaylistWithSongsResponse;

// Play Queue
export type PlayQueueContent = {
  entry: _SongResponse[];
  current?: string | null;
  position?: number | null;
  changedBy?: string | null;
};
export type PlayQueueResponse = { playQueue: PlayQueueContent };

// Server-side Queue (new API)
export type { StartQueueResponse } from "./generated";
export type { GetQueueResponse } from "./generated";
export type { QueueWindow } from "./generated";
export type { QueueSongEntry } from "./generated";
export type { QueueSourceInfo } from "./generated";
export type { QueueSuccessResponse } from "./generated";

// Play History
export type PlayHistoryEntry = _FerrotunePlayHistoryEntry;
export type PlayHistoryContent = {
  entry: _FerrotunePlayHistoryResponse["entry"];
  total?: number;
};
export type PlayHistoryResponse = { playHistory: PlayHistoryContent };

// Directory browsing (getIndexes, getMusicDirectory)
export type Indexes = _IndexesData;
export type IndexesResponse = _FerrotuneIndexesResponse;
export type { DirectoryIndex } from "./generated";
export type { DirectoryArtist } from "./generated";
export type DirectoryChild = _SongResponse & { isDir?: boolean };
export type Directory = { id: string; name: string; child: DirectoryChild[] };
export type DirectoryResponse = { directory: Directory };

// Ferrotune library browsing
export type { LibrariesResponse } from "./generated";
export type { LibraryInfo } from "./generated";
export type { DirectoryPagedResponse } from "./generated";
export type { DirectoryChildPaged } from "./generated";
export type { BreadcrumbItem } from "./generated";
export type { GetDirectoryPagedParams } from "./generated";

// getMusicFolders response
export type MusicFolders = _GeneratedMusicFoldersResponse;
export type MusicFoldersResponse = _GeneratedMusicFoldersResponse;

// License
export type License = { valid: boolean; email: string | null };

// Tag editing
export type { TagEntry } from "./generated";
export type { TagChange } from "./generated";
export type { AdditionalTagBlock } from "./generated";
export type { GetTagsResponse } from "./generated";
export type { UpdateTagsResponse } from "./generated";

// Stats
export type { StatsResponse } from "./generated";
import type { StatsResponse as _StatsResponse } from "./generated";
export type ServerStats = _StatsResponse;

// Listening stats
export type { ListeningStats } from "./generated";
export type { ListeningStatsResponse } from "./generated";

// User preferences
export type { PreferencesResponse } from "./generated";
import type { PreferencesResponse as _PreferencesResponse } from "./generated";
export type UserPreferences = _PreferencesResponse;

// Song IDs (for bulk selection)
export type { SongIdsResponse } from "./generated";

// ============================================================================
// API Parameter Types (generated from Rust)
// ============================================================================

// Re-export the enum type directly
export type { AlbumListType } from "./generated";

// Parameter types used by the client compatibility methods
export type AlbumListParams = {
  type: _AlbumListType;
  size?: number;
  offset?: number;
  fromYear?: number;
  toYear?: number;
  genre?: string;
  musicFolderId?: number;
};
export type { SearchParams } from "./generated";
export type RandomSongsParams = {
  size?: number;
  genre?: string;
  fromYear?: number;
  toYear?: number;
  musicFolderId?: number;
};
export type SongsByGenreParams = {
  genre: string;
  count?: number;
  offset?: number;
  musicFolderId?: number;
};

// ============================================================================
// Admin API Request Types (generated from Rust)
// ============================================================================

export type { UpdateTagsRequest } from "./generated";
export type { UpdatePreferencesRequest } from "./generated";

// ============================================================================
// Library Scanning Types (Admin API) - Generated from Rust
// ============================================================================

export type { ScanLogEntry } from "./generated";
export type { ScanProgressUpdate } from "./generated";
export type { ScanResponse } from "./generated";
export type { ScanStatusResponse } from "./generated";
export type { ScanProgress } from "./generated";
export type { ScanLogsResponse } from "./generated";
export type { FullScanStatusResponse } from "./generated";

// ScanRequest is used only for requests, not generated from Rust
export interface ScanRequest {
  full?: boolean;
  folderId?: number;
  dryRun?: boolean;
  analyzeReplaygain?: boolean;
  analyzeBliss?: boolean;
  analyzeWaveform?: boolean;
}

// ============================================================================
// Music Folder Management Types (Admin API) - Generated from Rust
// ============================================================================

export type { MusicFoldersResponse as MusicFoldersAdminResponse } from "./generated";
export type { MusicFolderInfo } from "./generated";
export type { MusicFolderStats } from "./generated";
export type { CreateMusicFolderRequest } from "./generated";
export type { CreateMusicFolderResponse } from "./generated";
export type { UpdateMusicFolderRequest } from "./generated";

// ============================================================================
// User Management Types (Admin API) - Generated from Rust
// ============================================================================

export type { UsersResponse } from "./generated";
export type { UserInfo } from "./generated";
export type { CreateUserRequest } from "./generated";
export type { CreateUserResponse } from "./generated";
export type { UpdateUserRequest } from "./generated";
export type { LibraryAccessResponse } from "./generated";
export type { SetLibraryAccessRequest } from "./generated";
export type { AuthLoginRequest } from "./generated";
export type { AuthLoginResponse } from "./generated";
export type { AuthMeResponse } from "./generated";
export type { AuthSessionRefreshResponse } from "./generated";
export type { AuthUrlTokenRequest } from "./generated";
export type { AuthUrlTokenResponse } from "./generated";
export type { AuthUserResponse } from "./generated";

// ============================================================================
// Connection Types (client-only)
// ============================================================================

export interface ServerConnection {
  serverUrl: string;
  username?: string;
  userId?: number;
  email?: string | null;
  isAdmin?: boolean;
  sessionToken?: string;
  sessionExpiresAt?: string;
  urlToken?: string;
  urlTokenExpiresAt?: string;
}
