// OpenSubsonic API Response Types
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

// Playlist entity
export type { PlaylistResponse } from "./generated";
export type { PlaylistResponse as Playlist } from "./generated";

// Music folder entity
export type { MusicFolderResponse } from "./generated";
export type { MusicFolderResponse as MusicFolder } from "./generated";

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
export type { PlaylistDetailResponse } from "./generated";
export type { PlaylistDetailResponse as PlaylistWithSongs } from "./generated";

// ============================================================================
// API Response Wrapper Types - What the endpoints actually return
// ============================================================================

// getArtists response: { artists: { index: [...] } }
export type { ArtistsResponse } from "./generated";
export type { ArtistsIndex } from "./generated";
export type { ArtistIndex } from "./generated";

// getArtist response: { artist: ArtistDetail }
// NOTE: This is what getArtist() returns - wrapper with detail
export type { ArtistDetailResponse } from "./generated";
// Client alias: ArtistResponse used to mean the wrapper
import type { ArtistDetailResponse as _ArtistDetailResponse } from "./generated";
export type ArtistResponse_Wrapper = _ArtistDetailResponse;

// getAlbum response: { album: AlbumDetail }
export type { AlbumDetailResponse } from "./generated";
// Client alias: AlbumResponse used to mean the wrapper
import type { AlbumDetailResponse as _AlbumDetailResponse } from "./generated";
export type AlbumResponse_Wrapper = _AlbumDetailResponse;

// getSong response: { song: SongResponse }
export type { SongDetailResponse } from "./generated";
import type { SongDetailResponse as _SongDetailResponse } from "./generated";
export type SongResponse_Wrapper = _SongDetailResponse;

// getGenres response: { genres: { genre: [...] } }
export type { GenresResponse } from "./generated";

// getAlbumList2 response
export type { AlbumList2Response } from "./generated";
export type { AlbumList2Content } from "./generated";
// Client alias for backward compat
import type { AlbumList2Response as _AlbumList2Response } from "./generated";
export type AlbumListResponse = _AlbumList2Response;

// getRandomSongs response
export type { RandomSongsResponse } from "./generated";

// getSongsByGenre response
export type { SongsByGenreResponse } from "./generated";

// search3 response
export type { SearchResult3 } from "./generated";
export type { SearchContent } from "./generated";
// Client alias for backward compat
import type { SearchResult3 as _SearchResult3 } from "./generated";
export type SearchResponse = _SearchResult3;

// getStarred2 response
export type { Starred2Response } from "./generated";
export type { Starred2Content } from "./generated";
// Client alias for backward compat
import type { Starred2Response as _Starred2Response } from "./generated";
export type StarredResponse = _Starred2Response;

// getPlaylists response
export type { PlaylistsResponse } from "./generated";

// getPlaylist response: { playlist: PlaylistDetail }
export type { PlaylistWithSongsResponse } from "./generated";
// Client alias for backward compat
import type { PlaylistWithSongsResponse as _PlaylistWithSongsResponse } from "./generated";
export type PlaylistResponse_Wrapper = _PlaylistWithSongsResponse;

// Play Queue
export type { PlayQueueResponse } from "./generated";
export type { PlayQueueContent } from "./generated";

// Play History
export type { PlayHistoryResponse } from "./generated";
export type { PlayHistoryContent } from "./generated";
export type { PlayHistoryEntry } from "./generated";

// getMusicFolders response
export type { MusicFolders } from "./generated";
import type { MusicFolders as _MusicFolders } from "./generated";
export type MusicFoldersResponse = _MusicFolders;

// License
export type { License } from "./generated";

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

// ============================================================================
// API Parameter Types (generated from Rust)
// ============================================================================

// Re-export the enum type directly
export type { AlbumListType } from "./generated";

// Re-export parameter types
export type { AlbumListParams } from "./generated";
export type { SearchParams } from "./generated";
export type { RandomSongsParams } from "./generated";
export type { SongsByGenreParams } from "./generated";

// ============================================================================
// Admin API Request Types (generated from Rust)
// ============================================================================

export type { UpdateTagsRequest } from "./generated";
export type { UpdatePreferencesRequest } from "./generated";

// ============================================================================
// Connection Types (client-only)
// ============================================================================

export interface ServerConnection {
  serverUrl: string;
  apiKey?: string;
  username?: string;
  password?: string;
}

// ============================================================================
// Base Response Types (client-only - for wrapping API responses)
// ============================================================================

/** Subsonic API response wrapper */
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

/** Subsonic API error */
export interface SubsonicError {
  code: number;
  message: string;
}
