import { toast } from "sonner";
import type { PlaylistFoldersResponse } from "./generated/PlaylistFoldersResponse";
import type { PlaylistFolderResponse } from "./generated/PlaylistFolderResponse";
import type {
  ServerConnection,
  MusicFoldersResponse,
  ArtistsResponse,
  ArtistDetailResponse,
  AlbumDetailResponse,
  SongDetailResponse,
  GenresResponse,
  AlbumListResponse,
  RandomSongsResponse,
  SongsByGenreResponse,
  SongsByGenreParams,
  SearchResponse,
  StarredResponse,
  PlaylistsResponse,
  PlaylistWithSongsResponse,
  PlayHistoryResponse,
  AlbumListParams,
  SearchParams,
  RandomSongsParams,
  GetTagsResponse,
  UpdateTagsRequest,
  UpdateTagsResponse,
  UserPreferences,
  UpdatePreferencesRequest,
  ServerStats,
  ListeningStatsResponse,
  StartQueueResponse,
  GetQueueResponse,
  LibrariesResponse,
  QueueSuccessResponse,
  IndexesResponse,
  SongIdsResponse,
  ScanRequest,
  ScanResponse,
  ScanStatusResponse,
  ScanLogsResponse,
  FullScanStatusResponse,
  MusicFoldersAdminResponse,
  MusicFolderInfo,
  CreateMusicFolderResponse,
  UsersResponse,
  UserInfo,
  CreateUserRequest,
  CreateUserResponse,
  UpdateUserRequest,
  LibraryAccessResponse,
  SetLibraryAccessRequest,
  ApiKeysResponse,
  CreateApiKeyResponse,
  PlaylistResponse,
  ForgottenFavoritesResponse,
} from "./types";
import type { DirectoryPagedResponse } from "./generated/DirectoryPagedResponse";
import type { GetDirectoryPagedParams } from "./generated/GetDirectoryPagedParams";
import type { ServerConfigResponse } from "./generated/ServerConfigResponse";
import type { UpdateServerConfigRequest } from "./generated/UpdateServerConfigRequest";
import type { PeriodReviewResponse } from "./generated/PeriodReviewResponse";
import type { ImportPlaylistRequest } from "./generated/ImportPlaylistRequest";
import type { ImportPlaylistResponse } from "./generated/ImportPlaylistResponse";
import type { BrowseFilesystemResponse } from "./generated/BrowseFilesystemResponse";
import type { ValidatePathResponse } from "./generated/ValidatePathResponse";
import type { PlaylistSongsResponse } from "./generated/PlaylistSongsResponse";
import type { ScanDetails } from "./generated/ScanDetails";
import type { SongMatchListResponse } from "./generated/SongMatchListResponse";
import type { MatchTracksRequest } from "./generated/MatchTracksRequest";
import type { MatchTracksResponse } from "./generated/MatchTracksResponse";
import type { MatchAlbumsRequest } from "./generated/MatchAlbumsRequest";
import type { MatchAlbumsResponse } from "./generated/MatchAlbumsResponse";
import type { MatchArtistsRequest } from "./generated/MatchArtistsRequest";
import type { MatchArtistsResponse } from "./generated/MatchArtistsResponse";
import type { SaveMatchDictionaryRequest } from "./generated/SaveMatchDictionaryRequest";
import type { SaveMatchDictionaryResponse } from "./generated/SaveMatchDictionaryResponse";
import type { ImportScrobblesRequest } from "./generated/ImportScrobblesRequest";
import type { ImportScrobblesResponse } from "./generated/ImportScrobblesResponse";
import type { LastfmAuthUrlResponse } from "./generated/LastfmAuthUrlResponse";
import type { LastfmConfigResponse } from "./generated/LastfmConfigResponse";
import type { LastfmConnectResponse } from "./generated/LastfmConnectResponse";
import type { LastfmStatusResponse } from "./generated/LastfmStatusResponse";
import type { ImportWithTimestampsRequest } from "./generated/ImportWithTimestampsRequest";
import type { ImportWithTimestampsResponse } from "./generated/ImportWithTimestampsResponse";
import type { GetPlayCountsRequest } from "./generated/GetPlayCountsRequest";
import type { GetPlayCountsResponse } from "./generated/GetPlayCountsResponse";
import type { CheckImportDuplicateResponse } from "./generated/CheckImportDuplicateResponse";
import type { DeleteSongFileResponse } from "./generated/DeleteSongFileResponse";
import type { DeleteSongFilesRequest } from "./generated/DeleteSongFilesRequest";
import type { MarkForDeletionRequest } from "./generated/MarkForDeletionRequest";
import type { MarkForDeletionResponse } from "./generated/MarkForDeletionResponse";
import type { SaveProgressEvent } from "./generated/SaveProgressEvent";
import type { RestoreSongsRequest } from "./generated/RestoreSongsRequest";
import type { RestoreSongsResponse } from "./generated/RestoreSongsResponse";
import type { RecycleBinResponse } from "./generated/RecycleBinResponse";
import type { PermanentDeleteRequest } from "./generated/PermanentDeleteRequest";
import type { PermanentDeleteResponse } from "./generated/PermanentDeleteResponse";
import type { SmartPlaylistsResponse } from "./generated/SmartPlaylistsResponse";
import type { SmartPlaylistInfo } from "./generated/SmartPlaylistInfo";
import type { RecentPlaylistsResponse } from "./generated/RecentPlaylistsResponse";
import type { SmartPlaylistSongsResponse } from "./generated/SmartPlaylistSongsResponse";
import type { CreateSmartPlaylistRequest } from "./generated/CreateSmartPlaylistRequest";
import type { CreateSmartPlaylistResponse } from "./generated/CreateSmartPlaylistResponse";
import type { UpdateSmartPlaylistRequest } from "./generated/UpdateSmartPlaylistRequest";
import type { MaterializeSmartPlaylistResponse } from "./generated/MaterializeSmartPlaylistResponse";
import type { UploadResponse } from "./generated/UploadResponse";
import type { StagedFilesResponse } from "./generated/StagedFilesResponse";
import type { StageLibraryTracksResponse } from "./generated/StageLibraryTracksResponse";
import type { BatchGetTagsResponse } from "./generated/BatchGetTagsResponse";
import type { BatchUpdateTagsResponse } from "./generated/BatchUpdateTagsResponse";
import type { SaveStagedFilesResponse } from "./generated/SaveStagedFilesResponse";
import type { RescanFilesResponse } from "./generated/RescanFilesResponse";
import type { RenameFilesResponse } from "./generated/RenameFilesResponse";
import type { CheckPathConflictsResponse } from "./generated/CheckPathConflictsResponse";
import type { SongPathsResponse } from "./generated/SongPathsResponse";
import type { TaggerSessionResponse } from "./generated/TaggerSessionResponse";
import type { TaggerPendingEditsResponse } from "./generated/TaggerPendingEditsResponse";
// TaggerPendingEditData import removed - now using individual track sync
import type { TaggerScriptsResponse } from "./generated/TaggerScriptsResponse";
import type { SessionListResponse } from "./generated/SessionListResponse";
import type { CreateSessionResponse } from "./generated/CreateSessionResponse";
import type { SessionSuccessResponse } from "./generated/SessionSuccessResponse";
import type { TaggerScriptData } from "./generated/TaggerScriptData";
import type { SongPlaylistsResponse } from "./generated/SongPlaylistsResponse";
import type { ShareableUsersResponse } from "./generated/ShareableUsersResponse";
import type { PlaylistSharesResponse } from "./generated/PlaylistSharesResponse";
import type { ShareEntry } from "./generated/ShareEntry";
import type { ServerFeatures } from "./generated/ServerFeatures";
import type { ReplacementAudioUploadResponse } from "./generated/ReplacementAudioUploadResponse";
import type { SetupStatusResponse } from "./generated/SetupStatusResponse";
import type { FerrotuneAlbumListResponse } from "./generated/FerrotuneAlbumListResponse";
import type { FerrotuneSearchResponse } from "./generated/FerrotuneSearchResponse";
import type { FerrotunePlayHistoryResponse } from "./generated/FerrotunePlayHistoryResponse";
import type { HomePageResponse } from "./generated/HomePageResponse";
import type { HomeContinueListeningSection } from "./generated/HomeContinueListeningSection";
import { PlaylistInFolder } from "./generated";

// Ping response is empty
type PingResponse = Record<string, never>;

/**
 * Options for importing from an audio file
 */
export interface ImportFromFileOptions {
  /** Whether to replace the audio (default: true) */
  importAudio?: boolean;
  /** Whether to import tags from the file */
  importTags?: boolean;
  /** Whether to import cover art from the file */
  importCoverArt?: boolean;
}

const API_VERSION = "1.16.1";
const CLIENT_NAME = "ferrotune-web";

/**
 * Returns the appropriate client name based on the current platform.
 * "ferrotune-mobile" for Tauri mobile apps, "ferrotune-web" otherwise.
 */
export function getClientName(): string {
  // Dynamic import would be async; use the same detection as isTauri()
  if (
    typeof window !== "undefined" &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__TAURI_INTERNALS__
  ) {
    return "ferrotune-mobile";
  }
  return CLIENT_NAME;
}

/**
 * Utility function to build query string from object params
 * Filters out undefined and null values
 */
function buildQueryString(params: Record<string, unknown>): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      searchParams.set(key, String(value));
    }
  }
  return searchParams.toString();
}

/**
 * Build endpoint URL with optional query string
 */
function buildEndpoint(base: string, params: Record<string, unknown>): string {
  const queryString = buildQueryString(params);
  return queryString ? `${base}?${queryString}` : base;
}

function toBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/**
 * Custom error class for API errors with status code
 */
export class FerrotuneApiError extends Error {
  status: number;
  code: number; // Alias for backwards compatibility

  constructor(status: number, message: string) {
    super(message);
    this.name = "FerrotuneApiError";
    this.status = status;
    this.code = status; // Keep for backwards compatibility
  }
}

// Rate-limit network error toasts to avoid spam when offline
const NETWORK_ERROR_TOAST_INTERVAL_MS = 10_000;
let lastNetworkErrorToastTime = 0;
let networkErrorToastsSuppressedUntil = 0;

/**
 * Temporarily suppress network error toasts for `durationMs` milliseconds.
 * Useful when resuming from background where the first requests may fail
 * before the network stack is ready.
 */
export function suppressNetworkErrorToasts(durationMs: number) {
  networkErrorToastsSuppressedUntil = Date.now() + durationMs;
}

function showNetworkErrorToast(message: string) {
  // Suppress when the browser reports offline — we know the network is down
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  // Suppress during post-resume grace period
  if (Date.now() < networkErrorToastsSuppressedUntil) return;
  const now = Date.now();
  if (now - lastNetworkErrorToastTime < NETWORK_ERROR_TOAST_INTERVAL_MS) return;
  lastNetworkErrorToastTime = now;
  toast.error(message);
}

/**
 * Get a user-friendly error message based on status code and error details
 */
function getUserFriendlyErrorMessage(
  status: number,
  serverMessage?: string,
): string {
  switch (status) {
    case 400:
      return serverMessage || "Invalid request. Please check your input.";
    case 401:
      return "Session expired. Please log in again.";
    case 403:
      return "You don't have permission to perform this action.";
    case 404:
      return serverMessage || "The requested resource was not found.";
    case 409:
      return serverMessage || "Conflict: The resource already exists.";
    case 413:
      return "Data too large. Please try with less data.";
    case 429:
      return "Too many requests. Please try again later.";
    case 500:
      return "Server error. Please try again later.";
    case 502:
    case 503:
    case 504:
      return "Server is temporarily unavailable. Please try again later.";
    default:
      return serverMessage || `Request failed (${status})`;
  }
}

export class FerrotuneClient {
  private serverUrl: string;
  private apiKey?: string;
  private username?: string;
  private password?: string;

  constructor(connection: ServerConnection) {
    this.serverUrl = connection.serverUrl.replace(/\/$/, "");
    this.apiKey = connection.apiKey;
    this.username = connection.username;
    this.password = connection.password;
  }

  // System endpoints
  async ping(): Promise<PingResponse> {
    return this.request<PingResponse>("/ferrotune/ping");
  }

  async completeSetup(): Promise<SetupStatusResponse> {
    return this.request<SetupStatusResponse>("/ferrotune/setup/complete", {
      method: "POST",
    });
  }

  async getMusicFolders(): Promise<MusicFoldersResponse> {
    return this.request<MusicFoldersResponse>("/ferrotune/music-folders");
  }

  // Browse endpoints
  async getArtists(musicFolderId?: number): Promise<ArtistsResponse> {
    const endpoint = buildEndpoint("/ferrotune/artists", { musicFolderId });
    return this.request<ArtistsResponse>(endpoint);
  }

  async getArtist(
    id: string,
    options?: { sort?: string; sortDir?: string; filter?: string },
  ): Promise<ArtistDetailResponse> {
    const endpoint = buildEndpoint(
      `/ferrotune/artists/${encodeURIComponent(id)}`,
      {
        sort: options?.sort,
        sortDir: options?.sortDir,
        filter: options?.filter,
      },
    );
    return this.request<ArtistDetailResponse>(endpoint);
  }

  async getAlbum(
    id: string,
    options?: { sort?: string; sortDir?: string; filter?: string },
  ): Promise<AlbumDetailResponse> {
    const endpoint = buildEndpoint(
      `/ferrotune/albums/${encodeURIComponent(id)}`,
      {
        sort: options?.sort,
        sortDir: options?.sortDir,
        filter: options?.filter,
      },
    );
    return this.request<AlbumDetailResponse>(endpoint);
  }

  async getSong(id: string): Promise<SongDetailResponse> {
    // Note: getSong is handled by get_song in browse.rs, mapped to /ferrotune/songs/:id
    return this.request<SongDetailResponse>(
      `/ferrotune/songs/${encodeURIComponent(id)}`,
    );
  }

  async getGenres(): Promise<GenresResponse> {
    return this.request<GenresResponse>("/ferrotune/genres");
  }

  // Directory browsing endpoints
  async getIndexes(musicFolderId?: number): Promise<IndexesResponse> {
    const endpoint = buildEndpoint("/ferrotune/indexes", { musicFolderId });
    return this.request<IndexesResponse>(endpoint);
  }

  // Get accessible libraries (music folders)
  async getLibraries(): Promise<LibrariesResponse> {
    return this.request<LibrariesResponse>("/ferrotune/libraries");
  }

  // Paginated directory browsing (Ferrotune extension)
  async getDirectoryPaged(
    params: Partial<GetDirectoryPagedParams> & {
      inlineImages?: "small" | "medium";
    } = {},
  ): Promise<DirectoryPagedResponse> {
    const endpoint = buildEndpoint("/ferrotune/directory", params);
    return this.request<DirectoryPagedResponse>(endpoint);
  }

  // List endpoints
  // AlbumListParams requires 'type', other fields are optional
  async getAlbumList2(
    params: Pick<AlbumListParams, "type"> &
      Partial<Omit<AlbumListParams, "type">> & {
        inlineImages?: "small" | "medium";
        since?: string;
        seed?: number;
      },
  ): Promise<AlbumListResponse> {
    const endpoint = buildEndpoint("/ferrotune/albums", params);

    const res = await this.request<FerrotuneAlbumListResponse>(endpoint);

    return {
      albumList2: {
        album: res.album,
        total: res.total ?? undefined,
        seed: res.seed ?? undefined,
      },
    };
  }

  async getRandomSongs(
    params: Partial<RandomSongsParams> = {},
  ): Promise<RandomSongsResponse> {
    const endpoint = buildEndpoint("/ferrotune/songs/random", params);
    return this.request<RandomSongsResponse>(endpoint);
  }

  async getSongsByGenre(
    genre: string,
    params: Partial<Omit<SongsByGenreParams, "genre">> = {},
  ): Promise<SongsByGenreResponse> {
    const endpoint = buildEndpoint("/ferrotune/songs/by-genre", {
      genre,
      ...params,
    });
    return this.request<SongsByGenreResponse>(endpoint);
  }

  async getForgottenFavorites(
    params: {
      size?: number;
      offset?: number;
      seed?: number;
      minPlays?: number;
      notPlayedSinceDays?: number;
      inlineImages?: "small" | "medium";
    } = {},
  ): Promise<ForgottenFavoritesResponse> {
    const endpoint = buildEndpoint(
      "/ferrotune/songs/forgotten-favorites",
      params,
    );
    return this.request<ForgottenFavoritesResponse>(endpoint);
  }

  async getHomePage(
    params: {
      size?: number;
      inlineImages?: "small" | "medium";
      discoverSeed?: number;
      forgottenFavSeed?: number;
    } = {},
  ): Promise<HomePageResponse> {
    const endpoint = buildEndpoint("/ferrotune/home", params);
    return this.request<HomePageResponse>(endpoint);
  }

  async getContinueListening(
    params: {
      size?: number;
      offset?: number;
      inlineImages?: "small" | "medium";
    } = {},
  ): Promise<HomeContinueListeningSection> {
    const endpoint = buildEndpoint("/ferrotune/continue-listening", params);
    return this.request<HomeContinueListeningSection>(endpoint);
  }

  // Search endpoint
  // SearchParams requires 'query', other fields are optional
  async search3(
    params: Pick<SearchParams, "query"> & Partial<Omit<SearchParams, "query">>,
  ): Promise<SearchResponse> {
    const endpoint = buildEndpoint("/ferrotune/search", params);

    const res = await this.request<FerrotuneSearchResponse>(endpoint);

    return {
      searchResult3: {
        artist: res.searchResult.artist,
        album: res.searchResult.album,
        song: res.searchResult.song,
        artistTotal: res.searchResult.artistTotal ?? undefined,
        albumTotal: res.searchResult.albumTotal ?? undefined,
        songTotal: res.searchResult.songTotal ?? undefined,
      },
    };
  }

  // Starring endpoints
  async star(params: {
    id?: string | string[];
    albumId?: string | string[];
    artistId?: string | string[];
  }): Promise<void> {
    const body: Record<string, string[]> = {};
    if (params.id) {
      body.id = Array.isArray(params.id) ? params.id : [params.id];
    }
    if (params.albumId) {
      body.albumId = Array.isArray(params.albumId)
        ? params.albumId
        : [params.albumId];
    }
    if (params.artistId) {
      body.artistId = Array.isArray(params.artistId)
        ? params.artistId
        : [params.artistId];
    }

    await this.request("/ferrotune/star", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async unstar(params: {
    id?: string | string[];
    albumId?: string | string[];
    artistId?: string | string[];
  }): Promise<void> {
    const body: Record<string, string[]> = {};
    if (params.id) {
      body.id = Array.isArray(params.id) ? params.id : [params.id];
    }
    if (params.albumId) {
      body.albumId = Array.isArray(params.albumId)
        ? params.albumId
        : [params.albumId];
    }
    if (params.artistId) {
      body.artistId = Array.isArray(params.artistId)
        ? params.artistId
        : [params.artistId];
    }

    await this.request("/ferrotune/unstar", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async setRating(id: string, rating: number): Promise<void> {
    await this.request("/ferrotune/rating", {
      method: "POST",
      body: JSON.stringify({ id, rating }),
    });
  }

  async getStarred2(): Promise<StarredResponse> {
    return this.request<StarredResponse>("/ferrotune/starred");
  }

  async scrobble(
    id: string,
    time?: number,
    submission = true,
    queueSourceType?: string,
    queueSourceId?: string,
  ): Promise<void> {
    await this.request("/ferrotune/scrobbles", {
      method: "POST",
      body: JSON.stringify({
        id,
        time,
        submission,
        queueSourceType,
        queueSourceId,
      }),
    });
  }

  // Last.fm integration
  async getLastfmStatus(): Promise<LastfmStatusResponse> {
    return this.request("/ferrotune/lastfm/status");
  }

  async getLastfmConfig(): Promise<LastfmConfigResponse> {
    return this.request("/ferrotune/lastfm/config");
  }

  async saveLastfmConfig(
    apiKey: string,
    apiSecret: string,
  ): Promise<LastfmConfigResponse> {
    return this.request("/ferrotune/lastfm/config", {
      method: "PUT",
      body: JSON.stringify({ apiKey, apiSecret }),
    });
  }

  async getLastfmAuthUrl(callbackUrl: string): Promise<LastfmAuthUrlResponse> {
    const endpoint = buildEndpoint("/ferrotune/lastfm/auth-url", {
      callbackUrl,
    });
    return this.request(endpoint);
  }

  async lastfmCallback(token: string): Promise<LastfmConnectResponse> {
    const endpoint = buildEndpoint("/ferrotune/lastfm/callback", { token });
    return this.request(endpoint, { method: "POST" });
  }

  async disconnectLastfm(): Promise<LastfmConnectResponse> {
    return this.request("/ferrotune/lastfm/disconnect", { method: "POST" });
  }

  // Playlist endpoints
  async getPlaylists(): Promise<PlaylistsResponse> {
    const res = await this.request<PlaylistFoldersResponse>(
      "/ferrotune/playlist-folders",
    );

    const mapToPlaylist = (p: PlaylistInFolder): PlaylistResponse => ({
      id: p.id,
      name: p.name,
      comment: null,
      owner: "admin", // default
      public: false,
      songCount: p.songCount || 0,
      duration: p.duration || 0,
      created: new Date().toISOString(),
      changed: new Date().toISOString(),
      coverArt: null,
    });

    const allPlaylists = (res.playlists || []).map(mapToPlaylist);

    return {
      playlists: {
        playlist: allPlaylists,
      },
    } as unknown as PlaylistsResponse;
  }

  /**
   * Get playlist folders with their full structure for tree display.
   * Returns both folder entities and playlists with their folder references.
   */
  async getPlaylistFoldersWithStructure(): Promise<PlaylistFoldersResponse> {
    return this.request<PlaylistFoldersResponse>("/ferrotune/playlist-folders");
  }

  async getPlaylist(
    id: string,
    options?: {
      sort?: string;
      sortDir?: string;
      filter?: string;
      offset?: number;
      count?: number;
    },
  ): Promise<PlaylistWithSongsResponse> {
    const endpoint = buildEndpoint(
      `/ferrotune/playlists/${encodeURIComponent(id)}`,
      { ...options, inlineImages: "small" },
    );

    const res = await this.request<PlaylistSongsResponse>(endpoint);

    // Adapt to PlaylistWithSongsResponse
    // Extract songs from entries
    // Filter out missing entries for compatibility with old clients expecting pure songs
    const songs = res.entries.filter((e) => e.song).map((e) => e.song!);

    return {
      playlist: {
        id: res.id,
        name: res.name,
        comment: res.comment,
        owner: res.owner,
        public: res.public,
        songCount: res.filteredCount, // Use filtered count as effectively returned count
        duration: res.duration,
        created: res.created,
        changed: res.changed,
        coverArt: res.coverArt,
        entry: songs,
      },
    } as unknown as PlaylistWithSongsResponse;
  }

  async createPlaylist(params: {
    name: string;
    songId?: string[];
    folderId?: string | null;
  }): Promise<PlaylistWithSongsResponse> {
    // Map songId[] to entries
    const entries = params.songId?.map((id) => ({ songId: id })) || [];

    // Use Ferrotune API to create playlist
    const res = await this.request<ImportPlaylistResponse>(
      "/ferrotune/playlists",
      {
        method: "POST",
        body: JSON.stringify({
          name: params.name,
          entries,
          folderId: params.folderId ?? undefined,
        }),
      },
    );

    // Fetch the created playlist to return full details expected by caller
    return this.getPlaylist(res.playlistId);
  }

  async updatePlaylist(params: {
    playlistId: string;
    name?: string;
    comment?: string;
    public?: boolean;
    songIdToAdd?: string[];
    songIndexToRemove?: number[];
  }): Promise<void> {
    // 1. Metadata update
    if (
      params.name !== undefined ||
      params.comment !== undefined ||
      params.public !== undefined
    ) {
      await this.request(
        `/ferrotune/playlists/${encodeURIComponent(params.playlistId)}`,
        {
          method: "PUT",
          body: JSON.stringify({
            name: params.name,
            comment: params.comment,
            public: params.public,
          }),
        },
      );
    }

    // 2. Add songs
    if (params.songIdToAdd && params.songIdToAdd.length > 0) {
      await this.request(
        `/ferrotune/playlists/${encodeURIComponent(params.playlistId)}/songs`,
        {
          method: "POST",
          body: JSON.stringify({ songIds: params.songIdToAdd }),
        },
      );
    }

    // 3. Remove songs
    if (params.songIndexToRemove && params.songIndexToRemove.length > 0) {
      await this.request(
        `/ferrotune/playlists/${encodeURIComponent(params.playlistId)}/songs`,
        {
          method: "DELETE",
          body: JSON.stringify({ indexes: params.songIndexToRemove }),
        },
      );
    }
  }

  async deletePlaylist(id: string): Promise<void> {
    await this.request(`/ferrotune/playlists/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  async getShareableUsers(): Promise<ShareableUsersResponse> {
    return this.request("/ferrotune/users/shareable");
  }

  async getPlaylistShares(playlistId: string): Promise<PlaylistSharesResponse> {
    return this.request(
      `/ferrotune/playlists/${encodeURIComponent(playlistId)}/shares`,
    );
  }

  async setPlaylistShares(
    playlistId: string,
    shares: ShareEntry[],
  ): Promise<PlaylistSharesResponse> {
    return this.request(
      `/ferrotune/playlists/${encodeURIComponent(playlistId)}/shares`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shares }),
      },
    );
  }

  async transferPlaylistOwnership(
    playlistId: string,
    newOwnerId: number,
  ): Promise<void> {
    await this.request(
      `/ferrotune/playlists/${encodeURIComponent(playlistId)}/transfer-ownership`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newOwnerId }),
      },
    );
  }

  /**
   * Get playlists that contain the specified songs.
   * Returns a map of songId -> list of playlists containing that song.
   */
  async getPlaylistsContainingSongs(
    songIds: string[],
  ): Promise<SongPlaylistsResponse> {
    if (songIds.length === 0) {
      return { playlistsBySong: {} };
    }
    const params = new URLSearchParams();
    for (const id of songIds) {
      params.append("songId", id);
    }
    return this.request<SongPlaylistsResponse>(
      `/ferrotune/playlists/containing-songs?${params.toString()}`,
    );
  }
  // Play Queue endpoints
  async savePlayQueue(params: {
    songIds: string[];
    current?: string;
    position?: number;
  }): Promise<void> {
    await this.request("/ferrotune/play-queue", {
      method: "POST",
      body: JSON.stringify({
        songIds: params.songIds,
        current: params.current,
        position: params.position,
      }),
    });
  }

  // Play History endpoint (migrated to Ferrotune API)
  async getPlayHistory(
    params: {
      size?: number;
      offset?: number;
      sort?: string;
      sortDir?: string;
      filter?: string;
      inlineImages?: "small" | "medium";
    } = {},
  ): Promise<PlayHistoryResponse> {
    const endpoint = buildEndpoint("/ferrotune/history", params);

    const res = await this.request<FerrotunePlayHistoryResponse>(endpoint);

    return {
      playHistory: {
        entry: res.entry,
        total: res.total ?? undefined,
      },
    };
  }

  // Media URL builders (no fetch, returns URL string)
  getStreamUrl(
    id: string,
    options?: {
      maxBitRate?: number;
      format?: string;
      timeOffset?: number;
      seekMode?: "accurate" | "coarse";
    },
  ): string {
    const params = new URLSearchParams();
    // Add auth params manually
    if (this.username && this.password) {
      params.set("u", this.username);
      params.set("p", this.password);
    } else if (this.apiKey) {
      params.set("apiKey", this.apiKey);
    }

    params.set("v", API_VERSION);
    params.set("c", CLIENT_NAME);
    params.set("id", id);
    if (options?.maxBitRate)
      params.set("maxBitRate", String(options.maxBitRate));
    if (options?.format) params.set("format", options.format);
    if (options?.timeOffset !== undefined && options.timeOffset > 0)
      params.set("timeOffset", String(Math.floor(options.timeOffset)));
    if (options?.seekMode) params.set("seekMode", options.seekMode);

    return `${this.serverUrl}/ferrotune/stream?${params.toString()}`;
  }

  /**
   * Get cover art URL for a given ID
   * @param id - The cover art ID (album, song, artist, or playlist)
   * @param size - Size tier: "small" (for rows/lists), "medium" (for cards), or "large" (original)
   *               For backwards compatibility, numeric sizes are also accepted and mapped to tiers
   * @param cacheBuster - Optional cache buster (e.g. cover art hash) to force browser refresh
   */
  getCoverArtUrl(
    id: string,
    size?: "small" | "medium" | "large" | number,
    cacheBuster?: string,
  ): string {
    // Convert numeric sizes to tier names for efficiency
    let sizeParam: string | undefined;
    if (typeof size === "number") {
      if (size <= 80) {
        sizeParam = "small";
      } else if (size <= 256) {
        sizeParam = "medium";
      } else {
        sizeParam = "large";
      }
    } else {
      sizeParam = size;
    }

    const params = new URLSearchParams();
    if (this.username && this.password) {
      params.set("u", this.username);
      params.set("p", this.password);
    } else if (this.apiKey) {
      params.set("apiKey", this.apiKey);
    }
    params.set("v", API_VERSION);
    params.set("c", CLIENT_NAME);
    params.set("id", id);
    if (sizeParam) params.set("size", sizeParam);
    if (cacheBuster) params.set("_", cacheBuster);

    return `${this.serverUrl}/ferrotune/cover-art?${params.toString()}`;
  }

  getDownloadUrl(id: string): string {
    const params = new URLSearchParams();
    if (this.username && this.password) {
      params.set("u", this.username);
      params.set("p", this.password);
    } else if (this.apiKey) {
      params.set("apiKey", this.apiKey);
    }
    params.set("v", API_VERSION);
    params.set("c", CLIENT_NAME);
    params.set("id", id);

    return `${this.serverUrl}/ferrotune/download?${params.toString()}`;
  }

  // Admin API methods
  private buildAdminUrl(endpoint: string): string {
    return `${this.serverUrl}${endpoint}`;
  }

  private getAuthorizationHeader(): string | undefined {
    if (!this.username || !this.password) {
      return undefined;
    }

    return `Basic ${toBase64Utf8(`${this.username}:${this.password}`)}`;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    /** If true, don't show error toast on failure */
    silent: boolean = false,
  ): Promise<T> {
    const url = this.buildAdminUrl(endpoint);

    // Build auth header
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };

    const authorization = this.getAuthorizationHeader();
    if (authorization) {
      headers["Authorization"] = authorization;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        ...options,
        headers,
      });
    } catch (fetchError) {
      // Check if this is an abort error
      if (
        fetchError instanceof DOMException &&
        fetchError.name === "AbortError"
      ) {
        throw fetchError; // Re-throw abort errors without toast
      }
      // Network error (offline, connection refused, etc.)
      const message = "Network error. Please check your connection.";
      if (!silent) {
        showNetworkErrorToast(message);
      }
      throw new FerrotuneApiError(0, message);
    }

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const serverMessage = data.error as string | undefined;
      const userMessage = getUserFriendlyErrorMessage(
        response.status,
        serverMessage,
      );

      if (!silent) {
        // Rate-limit server unavailability errors (502/503/504) the same as
        // network errors to avoid toast spam during connectivity issues
        if (response.status >= 502 && response.status <= 504) {
          showNetworkErrorToast(userMessage);
        } else {
          toast.error(userMessage);
        }
      }

      throw new FerrotuneApiError(
        response.status,
        serverMessage || `HTTP error: ${response.status}`,
      );
    }

    // Handle 204 No Content responses
    if (response.status === 204) {
      return undefined as T;
    }

    // Handle 200 OK with empty body (some endpoints return just status code)
    const contentLength = response.headers.get("content-length");
    if (contentLength === "0") {
      return undefined as T;
    }

    // Try to parse as JSON, but handle empty responses gracefully
    const text = await response.text();
    if (!text) {
      return undefined as T;
    }

    return JSON.parse(text) as T;
  }

  async deleteSongFromDatabase(
    id: string,
  ): Promise<{ success: boolean; message: string }> {
    return this.request(`/ferrotune/songs/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  /**
   * Delete song files from disk and database.
   * This is a destructive operation that permanently removes the files.
   * Requires 'allow_file_deletion' setting to be enabled.
   */
  async deleteSongFiles(songIds: string[]): Promise<DeleteSongFileResponse> {
    return this.request("/ferrotune/songs/delete-files", {
      method: "POST",
      body: JSON.stringify({ songIds } as DeleteSongFilesRequest),
    });
  }

  // ============ Recycle Bin ============

  /**
   * Mark songs for deletion (soft delete).
   * Songs are moved to recycle bin and will be permanently deleted after 30 days.
   */
  async markForDeletion(songIds: string[]): Promise<MarkForDeletionResponse> {
    return this.request("/ferrotune/recycle-bin/mark", {
      method: "POST",
      body: JSON.stringify({ songIds } as MarkForDeletionRequest),
    });
  }

  /**
   * Restore songs from recycle bin.
   */
  async restoreSongs(songIds: string[]): Promise<RestoreSongsResponse> {
    return this.request("/ferrotune/recycle-bin/restore", {
      method: "POST",
      body: JSON.stringify({ songIds } as RestoreSongsRequest),
    });
  }

  /**
   * Get songs in the recycle bin.
   */
  async getRecycleBin(params?: {
    offset?: number;
    limit?: number;
  }): Promise<RecycleBinResponse> {
    const endpoint = buildEndpoint("/ferrotune/recycle-bin", params ?? {});
    return this.request(endpoint);
  }

  /**
   * Permanently delete songs from recycle bin (from disk and database).
   */
  async deletePermanently(songIds: string[]): Promise<PermanentDeleteResponse> {
    return this.request("/ferrotune/recycle-bin/delete-permanently", {
      method: "POST",
      body: JSON.stringify({ songIds } as PermanentDeleteRequest),
    });
  }

  /**
   * Empty the entire recycle bin.
   */
  async emptyRecycleBin(): Promise<PermanentDeleteResponse> {
    return this.request("/ferrotune/recycle-bin/empty", {
      method: "POST",
    });
  }

  /**
   * Purge expired songs (older than 30 days).
   */
  async purgeExpired(): Promise<PermanentDeleteResponse> {
    return this.request("/ferrotune/recycle-bin/purge-expired", {
      method: "POST",
    });
  }

  /**
   * Get all song IDs matching the given search/filter criteria.
   * Useful for bulk operations like "select all matching songs".
   */
  async getSongIds(
    params: Partial<SearchParams> = {},
  ): Promise<SongIdsResponse> {
    const endpoint = buildEndpoint("/ferrotune/songs/ids", params);
    return this.request<SongIdsResponse>(endpoint);
  }

  // Tag management endpoints (Admin API)
  async getSongTags(id: string): Promise<GetTagsResponse> {
    return this.request(`/ferrotune/songs/${encodeURIComponent(id)}/tags`);
  }

  async updateSongTags(
    id: string,
    request: UpdateTagsRequest,
  ): Promise<UpdateTagsResponse> {
    return this.request(`/ferrotune/songs/${encodeURIComponent(id)}/tags`, {
      method: "PATCH",
      body: JSON.stringify(request),
    });
  }

  // User preferences endpoints (Admin API)
  async getPreferences(): Promise<UserPreferences> {
    return this.request("/ferrotune/preferences");
  }

  async updatePreferences(
    request: UpdatePreferencesRequest,
  ): Promise<UserPreferences> {
    return this.request("/ferrotune/preferences", {
      method: "PUT",
      body: JSON.stringify(request),
    });
  }

  async getPreference<T = unknown>(
    key: string,
  ): Promise<{ key: string; value: T | null }> {
    return this.request(`/ferrotune/preferences/${encodeURIComponent(key)}`);
  }

  async setPreference<T = unknown>(
    key: string,
    value: T,
  ): Promise<{ key: string; value: T }> {
    return this.request(`/ferrotune/preferences/${encodeURIComponent(key)}`, {
      method: "PUT",
      body: JSON.stringify({ value }),
    });
  }

  async deletePreference(key: string): Promise<void> {
    await this.request(`/ferrotune/preferences/${encodeURIComponent(key)}`, {
      method: "DELETE",
    });
  }

  // Server statistics endpoint (Admin API)
  async getStats(): Promise<ServerStats> {
    return this.request("/ferrotune/stats");
  }

  // Playlist management (Admin API)
  async reorderPlaylistSongs(
    playlistId: string,
    songIds: string[],
  ): Promise<void> {
    await this.request(
      `/ferrotune/playlists/${encodeURIComponent(playlistId)}/reorder`,
      {
        method: "PUT",
        body: JSON.stringify({ songIds }),
      },
    );
  }

  async importPlaylist(
    request: ImportPlaylistRequest,
  ): Promise<ImportPlaylistResponse> {
    return this.request("/ferrotune/playlists/import", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  async matchMissingEntry(
    playlistId: string,
    entryId: string,
    songId: string,
  ): Promise<void> {
    await this.request(
      `/ferrotune/playlists/${encodeURIComponent(playlistId)}/match-missing`,
      {
        method: "POST",
        body: JSON.stringify({ entryId, songId }),
      },
    );
  }

  /**
   * Unmatch a playlist entry - sets it back to missing state.
   * Only works for entries that have missing_entry_data (imported entries).
   */
  async unmatchEntry(playlistId: string, entryId: string): Promise<void> {
    await this.request(
      `/ferrotune/playlists/${encodeURIComponent(playlistId)}/unmatch`,
      {
        method: "POST",
        body: JSON.stringify({ entryId }),
      },
    );
  }

  /**
   * Batch match multiple missing playlist entries to songs in a single request.
   * Uses entry_id for stable identification of entries.
   */
  async batchMatchEntries(
    playlistId: string,
    entries: Array<{ entryId: string; songId: string }>,
  ): Promise<{ matchedCount: number; failedCount: number }> {
    return this.request(
      `/ferrotune/playlists/${encodeURIComponent(playlistId)}/batch-match`,
      {
        method: "POST",
        body: JSON.stringify({ entries }),
      },
    );
  }

  /**
   * Move a playlist entry to a new position.
   * Works for both songs and missing entries.
   */
  async movePlaylistEntry(
    playlistId: string,
    entryId: string,
    toPosition: number,
  ): Promise<void> {
    await this.request(
      `/ferrotune/playlists/${encodeURIComponent(playlistId)}/move-entry`,
      {
        method: "POST",
        body: JSON.stringify({ entryId, toPosition }),
      },
    );
  }

  /**
   * Get paginated playlist songs with interleaved missing entries.
   * This endpoint returns both matched songs and missing entries in their original
   * playlist positions, supporting filtering and sorting.
   */
  async getPlaylistSongs(
    playlistId: string,
    options?: {
      offset?: number;
      count?: number;
      sort?: string;
      sortDir?: string;
      filter?: string;
      entryType?: "song" | "missing";
      inlineImages?: "small" | "medium";
    },
  ): Promise<PlaylistSongsResponse> {
    const endpoint = buildEndpoint(
      `/ferrotune/playlists/${encodeURIComponent(playlistId)}/songs`,
      options ?? {},
    );
    return this.request(endpoint);
  }

  // Listening statistics (Admin API)
  async logListening(
    songId: string,
    durationSeconds: number,
    sessionId?: number,
    skipped?: boolean,
  ): Promise<{ success: boolean; sessionId: number }> {
    return this.request("/ferrotune/listening", {
      method: "POST",
      body: JSON.stringify({ songId, durationSeconds, sessionId, skipped }),
    });
  }

  async getListeningStats(): Promise<ListeningStatsResponse> {
    return this.request("/ferrotune/listening/stats");
  }

  async getPeriodReview(
    year?: number,
    month?: number,
    inlineImages?: "small" | "medium",
  ): Promise<PeriodReviewResponse> {
    const endpoint = buildEndpoint("/ferrotune/listening/review", {
      year,
      month,
      inlineImages,
    });
    return this.request(endpoint);
  }

  // Scrobbles import (Admin API)
  async importScrobbles(
    request: ImportScrobblesRequest,
  ): Promise<ImportScrobblesResponse> {
    return this.request("/ferrotune/scrobbles/import", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  /**
   * Import play events with individual timestamps (for JSON imports like Spotify).
   * Inserts into both scrobbles (for play counts) and listening_sessions (for Year in Review).
   */
  async importWithTimestamps(
    request: ImportWithTimestampsRequest,
  ): Promise<ImportWithTimestampsResponse> {
    return this.request("/ferrotune/scrobbles/import-with-timestamps", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  async getPlayCounts(songIds: string[]): Promise<GetPlayCountsResponse> {
    return this.request("/ferrotune/scrobbles/counts", {
      method: "POST",
      body: JSON.stringify({ songIds } as GetPlayCountsRequest),
    });
  }

  /**
   * Check if an import with the given description already exists.
   * Used to detect duplicate imports before proceeding.
   */
  async checkImportDuplicate(
    description: string,
  ): Promise<CheckImportDuplicateResponse> {
    const endpoint = buildEndpoint("/ferrotune/scrobbles/check-duplicate", {
      description,
    });
    return this.request(endpoint);
  }

  // Get pre-computed waveform data for a song.
  // Returns normalized heights array, or null if no waveform data is available.
  async getWaveform(songId: string): Promise<{ heights: number[] } | null> {
    try {
      return await this.request<{ heights: number[] }>(
        `/ferrotune/songs/${encodeURIComponent(songId)}/waveform`,
        {},
        true,
      );
    } catch {
      return null;
    }
  }

  // Get auth headers for streaming requests
  getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    const authorization = this.getAuthorizationHeader();
    if (authorization) {
      headers["Authorization"] = authorization;
    }
    return headers;
  }

  // Shuffle exclude endpoints (Admin API)
  async getShuffleExcludeStatus(
    songId: string,
  ): Promise<{ songId: string; excluded: boolean }> {
    return this.request(
      `/ferrotune/songs/${encodeURIComponent(songId)}/shuffle-exclude`,
    );
  }

  async setShuffleExclude(
    songId: string,
    excluded: boolean,
  ): Promise<{ songId: string; excluded: boolean }> {
    return this.request(
      `/ferrotune/songs/${encodeURIComponent(songId)}/shuffle-exclude`,
      {
        method: "PUT",
        body: JSON.stringify({ excluded }),
      },
    );
  }

  async getAllShuffleExcludes(): Promise<{ songIds: string[] }> {
    return this.request("/ferrotune/shuffle-excludes");
  }

  async bulkSetShuffleExcludes(
    songIds: string[],
    excluded: boolean,
  ): Promise<{ count: number; excluded: boolean }> {
    return this.request("/ferrotune/shuffle-excludes/bulk", {
      method: "POST",
      body: JSON.stringify({ songIds, excluded }),
    });
  }

  // ============================================================================
  // Disabled Songs API
  // ============================================================================

  async getDisabledStatus(
    songId: string,
  ): Promise<{ songId: string; disabled: boolean }> {
    return this.request(
      `/ferrotune/songs/${encodeURIComponent(songId)}/disabled`,
    );
  }

  async setDisabled(
    songId: string,
    disabled: boolean,
  ): Promise<{ songId: string; disabled: boolean }> {
    return this.request(
      `/ferrotune/songs/${encodeURIComponent(songId)}/disabled`,
      {
        method: "PUT",
        body: JSON.stringify({ disabled }),
      },
    );
  }

  async getAllDisabledSongs(): Promise<{ songIds: string[] }> {
    return this.request("/ferrotune/disabled-songs");
  }

  async bulkSetDisabled(
    songIds: string[],
    disabled: boolean,
  ): Promise<{ count: number; disabled: boolean }> {
    return this.request("/ferrotune/disabled-songs/bulk", {
      method: "POST",
      body: JSON.stringify({ songIds, disabled }),
    });
  }

  // ============================================================================
  // Server-Side Queue API (Admin API)
  // ============================================================================

  /**
   * Start a new queue from a source (album, artist, playlist, etc.)
   *
   * For sources like album, artist, playlist, genre, the server will
   * materialize the songs automatically.
   *
   * For search results or custom queues, provide songIds explicitly.
   */
  async startQueue(params: {
    sourceType: string;
    sourceId?: string;
    sourceName?: string;
    startIndex?: number;
    /** ID of the song to start playing (for verification against index) */
    startSongId?: string;
    shuffle?: boolean;
    repeatMode?: string;
    filters?: Record<string, unknown>;
    sort?: Record<string, unknown>;
    /** Explicit song IDs to use instead of materializing from source */
    songIds?: string[];
    /** Request inline cover art thumbnails */
    inlineImages?: "small" | "medium";
    /** Playback session ID for multi-session support */
    sessionId?: string;
  }): Promise<StartQueueResponse> {
    return this.request("/ferrotune/queue/start", {
      method: "POST",
      body: JSON.stringify(params),
    });
  }

  /**
   * Get the current queue state with optional pagination
   */
  async getServerQueue(
    params: {
      offset?: number;
      limit?: number;
      inlineImages?: "small" | "medium";
      signal?: AbortSignal;
      sessionId?: string;
    } = {},
  ): Promise<GetQueueResponse> {
    const query = new URLSearchParams();
    if (params.offset !== undefined) query.set("offset", String(params.offset));
    if (params.limit !== undefined) query.set("limit", String(params.limit));
    if (params.inlineImages !== undefined)
      query.set("inlineImages", params.inlineImages);
    if (params.sessionId !== undefined)
      query.set("sessionId", params.sessionId);
    const queryStr = query.toString();
    return this.request(`/ferrotune/queue${queryStr ? `?${queryStr}` : ""}`, {
      signal: params.signal,
    });
  }

  /**
   * Get songs around the current position
   */
  async getQueueCurrentWindow(
    radius: number = 20,
    inlineImages?: "small" | "medium",
    sessionId?: string,
  ): Promise<GetQueueResponse> {
    const params = new URLSearchParams();
    params.set("radius", String(radius));
    if (inlineImages !== undefined) params.set("inlineImages", inlineImages);
    if (sessionId !== undefined) params.set("sessionId", sessionId);
    return this.request(`/ferrotune/queue/current-window?${params.toString()}`);
  }

  /**
   * Add songs to the queue
   */
  async addToServerQueue(params: {
    songIds: string[];
    position: "next" | "end" | number;
    sourceType?: string;
    sourceId?: string;
    sessionId?: string;
  }): Promise<QueueSuccessResponse> {
    return this.request("/ferrotune/queue/add", {
      method: "POST",
      body: JSON.stringify({
        songIds: params.songIds,
        position: params.position,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        sessionId: params.sessionId,
      }),
    });
  }

  /**
   * Remove a song from the queue at a position
   */
  async removeFromServerQueue(
    position: number,
    sessionId?: string,
  ): Promise<QueueSuccessResponse> {
    const query = sessionId
      ? `?sessionId=${encodeURIComponent(sessionId)}`
      : "";
    return this.request(`/ferrotune/queue/${position}${query}`, {
      method: "DELETE",
    });
  }

  /**
   * Move a song from one position to another
   */
  async moveInServerQueue(
    fromPosition: number,
    toPosition: number,
    sessionId?: string,
  ): Promise<QueueSuccessResponse> {
    return this.request("/ferrotune/queue/move", {
      method: "POST",
      body: JSON.stringify({
        fromPosition,
        toPosition,
        sessionId,
      }),
    });
  }

  /**
   * Toggle shuffle mode
   */
  async toggleServerShuffle(
    enabled: boolean,
    sessionId?: string,
  ): Promise<QueueSuccessResponse> {
    return this.request("/ferrotune/queue/shuffle", {
      method: "POST",
      body: JSON.stringify({ enabled, sessionId }),
    });
  }

  /**
   * Update the current playback position
   */
  async updateServerQueuePosition(
    currentIndex: number,
    positionMs: number = 0,
    reshuffle: boolean = false,
    sessionId?: string,
  ): Promise<QueueSuccessResponse> {
    return this.request("/ferrotune/queue/position", {
      method: "POST",
      body: JSON.stringify({
        currentIndex,
        positionMs,
        ...(reshuffle && { reshuffle: true }),
        sessionId,
      }),
    });
  }

  /**
   * Update repeat mode
   */
  async updateServerRepeatMode(
    mode: "off" | "all" | "one",
    sessionId?: string,
  ): Promise<QueueSuccessResponse> {
    return this.request("/ferrotune/queue/repeat", {
      method: "POST",
      body: JSON.stringify({ mode, sessionId }),
    });
  }

  /**
   * Clear the entire queue
   */
  async clearServerQueue(sessionId?: string): Promise<QueueSuccessResponse> {
    const query = sessionId
      ? `?sessionId=${encodeURIComponent(sessionId)}`
      : "";
    return this.request(`/ferrotune/queue${query}`, {
      method: "DELETE",
    });
  }

  // ============================================================================
  // Server Features API
  // ============================================================================

  /**
   * Get server feature flags (which optional features are compiled in)
   */
  async getFeatures(): Promise<ServerFeatures> {
    return this.request("/ferrotune/features");
  }

  // ============================================================================
  // Library Scanning API (Admin API)
  // ============================================================================

  /**
   * Start a library scan
   *
   * @param request Scan options (full, folderId, dryRun)
   * @returns Immediate response indicating scan has started
   */
  async startScan(request: ScanRequest = {}): Promise<ScanResponse> {
    return this.request("/ferrotune/scan", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  /**
   * Cancel an in-progress scan
   */
  async cancelScan(): Promise<{ status: string; message: string }> {
    return this.request("/ferrotune/scan/cancel", {
      method: "POST",
    });
  }

  /**
   * Get scan details (lists of affected files)
   */
  async getScanDetails(): Promise<ScanDetails> {
    return this.request("/ferrotune/scan/details");
  }

  /**
   * Get all songs in a minimal format for client-side matching.
   * This returns id, title, artist, album, and duration for each song.
   * @deprecated Use matchTracks() for server-side matching instead
   */
  async getSongMatchList(libraryId?: number): Promise<SongMatchListResponse> {
    const params = new URLSearchParams();
    if (libraryId !== undefined) params.set("libraryId", libraryId.toString());
    const query = params.toString();
    return this.request(
      `/ferrotune/songs/match-list${query ? `?${query}` : ""}`,
    );
  }

  /**
   * Match tracks against the library using server-side fuzzy matching.
   * This is more accurate and performant than client-side matching with fuse.js.
   *
   * @param request The tracks to match and search options
   * @param libraryId Optional library ID to filter by
   * @returns Match results for each track
   */
  async matchTracks(
    request: MatchTracksRequest,
    libraryId?: number,
  ): Promise<MatchTracksResponse> {
    const params = new URLSearchParams();
    if (libraryId !== undefined) params.set("libraryId", libraryId.toString());
    const query = params.toString();
    return this.request(`/ferrotune/songs/match${query ? `?${query}` : ""}`, {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  /**
   * Match albums against the library using server-side fuzzy matching.
   * Used for bulk album favorites import from CSV.
   *
   * @param request The albums to match and search options
   * @param libraryId Optional library ID to filter by
   * @returns Match results for each album
   */
  async matchAlbums(
    request: MatchAlbumsRequest,
    libraryId?: number,
  ): Promise<MatchAlbumsResponse> {
    const params = new URLSearchParams();
    if (libraryId !== undefined) params.set("libraryId", libraryId.toString());
    const query = params.toString();
    return this.request(`/ferrotune/albums/match${query ? `?${query}` : ""}`, {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  /**
   * Match artists against the library using server-side fuzzy matching.
   * Used for bulk artist favorites import from CSV.
   *
   * @param request The artists to match
   * @param libraryId Optional library ID to filter by
   * @returns Match results for each artist
   */
  async matchArtists(
    request: MatchArtistsRequest,
    libraryId?: number,
  ): Promise<MatchArtistsResponse> {
    const params = new URLSearchParams();
    if (libraryId !== undefined) params.set("libraryId", libraryId.toString());
    const query = params.toString();
    return this.request(`/ferrotune/artists/match${query ? `?${query}` : ""}`, {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  /**
   * Save matches to the user's match dictionary for reuse in future imports.
   * This stores the mapping between original track info and matched song IDs
   * so they can be reused across all import types (playlists, favorites, play counts).
   *
   * @param request The entries to save
   * @returns Number of entries saved
   */
  async saveMatchDictionary(
    request: SaveMatchDictionaryRequest,
  ): Promise<SaveMatchDictionaryResponse> {
    return this.request("/ferrotune/match-dictionary", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  // ==========================================
  // Music Folder Management (Admin API)
  // ==========================================

  /**
   * List all music folders with their stats (Admin API)
   */
  async getAdminMusicFolders(): Promise<MusicFoldersAdminResponse> {
    return this.request("/ferrotune/music-folders");
  }

  /**
   * Get a single music folder with stats
   */
  async getAdminMusicFolder(id: number): Promise<MusicFolderInfo> {
    return this.request(`/ferrotune/music-folders/${id}`);
  }

  /**
   * Create a new music folder
   */
  async createMusicFolder(
    name: string,
    path: string,
    watchEnabled: boolean = false,
  ): Promise<CreateMusicFolderResponse> {
    return this.request("/ferrotune/music-folders", {
      method: "POST",
      body: JSON.stringify({ name, path, watchEnabled }),
    });
  }

  /**
   * Update a music folder (name, enabled status, or watch enabled)
   */
  async updateMusicFolder(
    id: number,
    updates: { name?: string; enabled?: boolean; watchEnabled?: boolean },
  ): Promise<void> {
    await this.request(`/ferrotune/music-folders/${id}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
  }

  /**
   * Delete a music folder and all its songs
   */
  async deleteMusicFolder(id: number): Promise<void> {
    await this.request(`/ferrotune/music-folders/${id}`, {
      method: "DELETE",
    });
  }

  // ==========================================
  // Filesystem Browsing (Admin API)
  // ==========================================

  /**
   * Browse the server's filesystem for selecting music folder paths.
   * If no path is provided, returns common root directories.
   */
  async browseFilesystem(path?: string): Promise<BrowseFilesystemResponse> {
    const params = path ? `?path=${encodeURIComponent(path)}` : "";
    return this.request(`/ferrotune/filesystem${params}`);
  }

  /**
   * Validate a filesystem path exists and is a readable directory.
   */
  async validatePath(path: string): Promise<ValidatePathResponse> {
    return this.request(
      `/ferrotune/filesystem/validate?path=${encodeURIComponent(path)}`,
    );
  }

  // ==========================================
  // Scanning (Admin API)
  // ==========================================

  /**
   * Get current scan status
   */
  async getScanStatus(): Promise<ScanStatusResponse> {
    return this.request("/ferrotune/scan/status");
  }

  /**
   * Get recent scan logs
   */
  async getScanLogs(): Promise<ScanLogsResponse> {
    return this.request("/ferrotune/scan/logs");
  }

  /**
   * Get full scan status including progress and logs
   */
  async getFullScanStatus(): Promise<FullScanStatusResponse> {
    return this.request("/ferrotune/scan/full");
  }

  /**
   * Get the SSE stream URL for scan progress updates
   */
  getScanProgressStreamUrl(): string {
    return this.buildAdminUrl("/ferrotune/scan/progress");
  }

  // ============================================================================
  // Playback Sessions API
  // ============================================================================

  /**
   * Create a new playback session
   */
  async createSession(
    clientName: string = "ferrotune-web",
  ): Promise<CreateSessionResponse> {
    return this.request("/ferrotune/sessions", {
      method: "POST",
      body: JSON.stringify({ clientName }),
    });
  }

  /**
   * List active sessions for the current user
   */
  async listSessions(): Promise<SessionListResponse> {
    return this.request("/ferrotune/sessions");
  }

  /**
   * Delete (end) a session
   */
  async deleteSession(sessionId: string): Promise<SessionSuccessResponse> {
    return this.request(
      `/ferrotune/sessions/${encodeURIComponent(sessionId)}`,
      {
        method: "DELETE",
      },
    );
  }

  /**
   * Fire-and-forget session delete using keepalive fetch.
   * Designed for use during page unload (beforeunload) where normal
   * async requests would be cancelled.
   */
  leaveSession(sessionId: string): void {
    const url = this.buildAdminUrl(
      `/ferrotune/sessions/${encodeURIComponent(sessionId)}`,
    );
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const authorization = this.getAuthorizationHeader();
    if (authorization) {
      headers["Authorization"] = authorization;
    }
    fetch(url, {
      method: "DELETE",
      headers,
      keepalive: true,
    }).catch(() => {
      // Best-effort — nothing to do if it fails during unload
    });
  }

  /**
   * Send heartbeat for a session (keeps it alive, updates playback state)
   */
  async sessionHeartbeat(
    sessionId: string,
    params: {
      isPlaying?: boolean;
      currentIndex?: number;
      positionMs?: number;
      currentSongId?: string;
      currentSongTitle?: string;
      currentSongArtist?: string;
    } = {},
  ): Promise<SessionSuccessResponse> {
    return this.request(
      `/ferrotune/sessions/${encodeURIComponent(sessionId)}/heartbeat`,
      {
        method: "POST",
        body: JSON.stringify(params),
      },
      true, // Silent — session cleanup is handled by recovery, not error toasts
    );
  }

  /**
   * Send a remote command to a session (play, pause, next, etc.)
   */
  async sendSessionCommand(
    sessionId: string,
    action: string,
    positionMs?: number,
    volume?: number,
    isMuted?: boolean,
    clientName?: string,
  ): Promise<SessionSuccessResponse> {
    return this.request(
      `/ferrotune/sessions/${encodeURIComponent(sessionId)}/command`,
      {
        method: "POST",
        body: JSON.stringify({
          action,
          positionMs,
          volume,
          isMuted,
          clientName,
        }),
      },
      true, // Silent — session errors are recovered automatically
    );
  }

  /**
   * Get the SSE stream URL for session events
   */
  getSessionEventsUrl(sessionId: string): string {
    const params = new URLSearchParams();
    if (this.username && this.password) {
      params.set("u", this.username);
      params.set("p", this.password);
    } else if (this.apiKey) {
      params.set("apiKey", this.apiKey);
    }
    params.set("v", API_VERSION);
    params.set("c", CLIENT_NAME);
    return this.buildAdminUrl(
      `/ferrotune/sessions/${encodeURIComponent(sessionId)}/events?${params.toString()}`,
    );
  }

  // ==========================================
  // User Management (Admin API)
  // ==========================================

  /**
   * Get current user info
   */
  async getCurrentUser(): Promise<UserInfo> {
    return this.request("/ferrotune/users/me");
  }

  /**
   * List all users (admin only)
   */
  async getUsers(): Promise<UsersResponse> {
    return this.request("/ferrotune/users");
  }

  /**
   * Get a single user by ID (admin only)
   */
  async getUser(id: number): Promise<UserInfo> {
    return this.request(`/ferrotune/users/${id}`);
  }

  /**
   * Create a new user (admin only)
   */
  async createUser(request: CreateUserRequest): Promise<CreateUserResponse> {
    return this.request("/ferrotune/users", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  /**
   * Update a user (admin only)
   */
  async updateUser(id: number, request: UpdateUserRequest): Promise<UserInfo> {
    return this.request(`/ferrotune/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(request),
    });
  }

  /**
   * Delete a user (admin only)
   */
  async deleteUser(id: number): Promise<void> {
    await this.request(`/ferrotune/users/${id}`, {
      method: "DELETE",
    });
  }

  /**
   * Get a user's library access (admin only)
   */
  async getUserLibraryAccess(userId: number): Promise<LibraryAccessResponse> {
    return this.request(`/ferrotune/users/${userId}/library-access`);
  }

  /**
   * Set a user's library access (admin only)
   */
  async setUserLibraryAccess(
    userId: number,
    folderIds: number[],
  ): Promise<LibraryAccessResponse> {
    return this.request(`/ferrotune/users/${userId}/library-access`, {
      method: "PUT",
      body: JSON.stringify({ folderIds } as SetLibraryAccessRequest),
    });
  }

  /**
   * Get a user's API keys (admin or self)
   */
  async getUserApiKeys(userId: number): Promise<ApiKeysResponse> {
    return this.request(`/ferrotune/users/${userId}/api-keys`);
  }

  /**
   * Create an API key for a user (admin or self)
   */
  async createUserApiKey(
    userId: number,
    name: string,
  ): Promise<CreateApiKeyResponse> {
    return this.request(`/ferrotune/users/${userId}/api-keys`, {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  }

  /**
   * Delete an API key for a user (admin or self)
   */
  async deleteUserApiKey(userId: number, keyName: string): Promise<void> {
    await this.request(
      `/ferrotune/users/${userId}/api-keys/${encodeURIComponent(keyName)}`,
      {
        method: "DELETE",
      },
    );
  }

  // ==========================================
  // Server Configuration (Admin API)
  // ==========================================

  /**
   * Get server configuration (admin only)
   */
  async getServerConfig(): Promise<ServerConfigResponse> {
    return this.request("/ferrotune/config");
  }

  /**
   * Update server configuration (admin only)
   */
  async updateServerConfig(
    request: UpdateServerConfigRequest,
  ): Promise<ServerConfigResponse> {
    return this.request("/ferrotune/config", {
      method: "PUT",
      body: JSON.stringify(request),
    });
  }

  // ==========================================
  // Smart Playlists (Admin API)
  // ==========================================

  /**
   * Get all smart playlists for the current user
   */
  async getSmartPlaylists(): Promise<SmartPlaylistsResponse> {
    return this.request("/ferrotune/smart-playlists");
  }

  async getRecentlyPlayedPlaylists(): Promise<RecentPlaylistsResponse> {
    return this.request("/ferrotune/playlists/recently-played");
  }

  /**
   * Get a single smart playlist by ID
   */
  async getSmartPlaylist(id: string): Promise<SmartPlaylistInfo> {
    return this.request(`/ferrotune/smart-playlists/${encodeURIComponent(id)}`);
  }

  /**
   * Create a new smart playlist
   */
  async createSmartPlaylist(
    request: CreateSmartPlaylistRequest,
  ): Promise<CreateSmartPlaylistResponse> {
    return this.request("/ferrotune/smart-playlists", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  /**
   * Update a smart playlist
   */
  async updateSmartPlaylist(
    id: string,
    request: UpdateSmartPlaylistRequest,
  ): Promise<void> {
    await this.request(`/ferrotune/smart-playlists/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(request),
    });
  }

  /**
   * Delete a smart playlist
   */
  async deleteSmartPlaylist(id: string): Promise<void> {
    await this.request(`/ferrotune/smart-playlists/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  /**
   * Get materialized songs from a smart playlist
   */
  async getSmartPlaylistSongs(
    id: string,
    options?: {
      offset?: number;
      count?: number;
      inlineImages?: "small" | "medium";
      filter?: string;
      sortField?: string;
      sortDirection?: "asc" | "desc";
    },
  ): Promise<SmartPlaylistSongsResponse> {
    const params = new URLSearchParams();
    if (options?.offset !== undefined)
      params.set("offset", String(options.offset));
    if (options?.count !== undefined)
      params.set("count", String(options.count));
    if (options?.inlineImages) params.set("inlineImages", options.inlineImages);
    if (options?.filter) params.set("filter", options.filter);
    if (options?.sortField) params.set("sortField", options.sortField);
    if (options?.sortDirection)
      params.set("sortDirection", options.sortDirection);
    const queryStr = params.toString();
    return this.request(
      `/ferrotune/smart-playlists/${encodeURIComponent(id)}/songs${queryStr ? `?${queryStr}` : ""}`,
    );
  }

  /**
   * Materialize a smart playlist into a regular (static) playlist.
   * Creates a new playlist containing a snapshot of the songs currently matching
   * the smart playlist's rules.
   */
  async materializeSmartPlaylist(
    id: string,
    options?: {
      name?: string;
      comment?: string;
    },
  ): Promise<MaterializeSmartPlaylistResponse> {
    return this.request(
      `/ferrotune/smart-playlists/${encodeURIComponent(id)}/materialize`,
      {
        method: "POST",
        body: JSON.stringify({
          name: options?.name ?? null,
          comment: options?.comment ?? null,
        }),
      },
    );
  }

  // ==========================================
  // Tagger API (Admin API)
  // ==========================================

  /**
   * Upload audio files to staging area
   */
  async uploadTaggerFiles(files: File[]): Promise<UploadResponse> {
    const formData = new FormData();
    for (const file of files) {
      formData.append("files", file);
    }

    const url = this.buildAdminUrl("/ferrotune/tagger/upload");
    const headers = this.getAuthHeaders();

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: formData,
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new FerrotuneApiError(
        response.status,
        data.error || `Upload failed: ${response.status}`,
      );
    }

    return response.json();
  }

  /**
   * Upload a single audio file to staging area
   * Useful for sequential uploads with progress tracking
   */
  async uploadTaggerFile(file: File): Promise<UploadResponse> {
    return this.uploadTaggerFiles([file]);
  }

  /**
   * List staged files for the current user
   */
  async getStagedFiles(): Promise<StagedFilesResponse> {
    return this.request("/ferrotune/tagger/staged");
  }

  /**
   * Discover orphaned files in staging directory that are not in session
   */
  async getOrphanedFiles(): Promise<{
    count: number;
    fileIds: string[];
  }> {
    return this.request("/ferrotune/tagger/orphaned");
  }

  /**
   * Delete a staged file
   */
  async deleteStagedFile(id: string): Promise<void> {
    await this.request(`/ferrotune/tagger/staged/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  /**
   * Get stream URL for a staged file (for preview playback).
   * Includes auth params since Audio elements can't use HTTP headers.
   */
  getStagedFileStreamUrl(id: string): string {
    const params = new URLSearchParams();
    // Add auth params for Audio element compatibility
    if (this.username && this.password) {
      params.set("u", this.username);
      params.set("p", this.password);
    } else if (this.apiKey) {
      params.set("apiKey", this.apiKey);
    }
    params.set("v", API_VERSION);
    params.set("c", CLIENT_NAME);

    return `${this.serverUrl}/ferrotune/tagger/staged/${encodeURIComponent(id)}/stream?${params.toString()}`;
  }

  /**
   * Get the URL for fetching cover art from a staged audio file.
   * Includes auth params since img elements can't use HTTP headers.
   */
  getStagedFileCoverUrl(id: string): string {
    const params = new URLSearchParams();
    // Add auth params for img element compatibility
    if (this.username && this.password) {
      params.set("u", this.username);
      params.set("p", this.password);
    } else if (this.apiKey) {
      params.set("apiKey", this.apiKey);
    }
    params.set("v", API_VERSION);
    params.set("c", CLIENT_NAME);

    return `${this.serverUrl}/ferrotune/tagger/staged/${encodeURIComponent(id)}/cover?${params.toString()}`;
  }

  /**
   * Stage library tracks for editing in the tagger
   */
  async stageLibraryTracks(
    songIds: string[],
  ): Promise<StageLibraryTracksResponse> {
    return this.request("/ferrotune/tagger/stage-library", {
      method: "POST",
      body: JSON.stringify({ songIds }),
    });
  }

  /**
   * Get tags for multiple songs
   */
  async batchGetTags(songIds: string[]): Promise<BatchGetTagsResponse> {
    const params = songIds
      .map((id) => `songIds=${encodeURIComponent(id)}`)
      .join("&");
    return this.request(`/ferrotune/tagger/batch-tags?${params}`);
  }

  /**
   * Update tags for multiple songs
   */
  async batchUpdateTags(
    updates: Array<{
      songId: string;
      set: Array<{ key: string; value: string }>;
      delete: string[];
    }>,
  ): Promise<BatchUpdateTagsResponse> {
    return this.request("/ferrotune/tagger/batch-tags", {
      method: "PATCH",
      body: JSON.stringify({ updates }),
    });
  }

  /**
   * Save staged files to the library
   */
  async saveStagedFiles(
    files: Array<{
      stagedId: string;
      musicFolderId: number;
      targetPath: string;
    }>,
  ): Promise<SaveStagedFilesResponse> {
    return this.request("/ferrotune/tagger/save", {
      method: "POST",
      body: JSON.stringify({ files }),
    });
  }

  /**
   * Rescan specific songs after tag changes
   */
  async rescanFiles(songIds: string[]): Promise<RescanFilesResponse> {
    return this.request("/ferrotune/tagger/rescan", {
      method: "POST",
      body: JSON.stringify({ songIds }),
    });
  }

  /**
   * Rename/move library files to new paths
   */
  async renameFiles(
    renames: Array<{ songId: string; newPath: string }>,
  ): Promise<RenameFilesResponse> {
    return this.request("/ferrotune/tagger/rename", {
      method: "POST",
      body: JSON.stringify({ renames }),
    });
  }

  /**
   * Check if any proposed rename paths would conflict with existing files.
   * Returns conflicts with suggested alternative paths.
   * For staged tracks, include targetMusicFolderId to specify the target library.
   */
  async checkPathConflicts(
    renames: Array<{
      songId: string;
      newPath: string;
      targetMusicFolderId?: number;
    }>,
  ): Promise<CheckPathConflictsResponse> {
    return this.request("/ferrotune/tagger/check-conflicts", {
      method: "POST",
      body: JSON.stringify({ renames }),
    });
  }

  /**
   * Get lightweight metadata for all songs (for rename script path comparison)
   */
  async getSongPaths(): Promise<SongPathsResponse> {
    return this.request("/ferrotune/tagger/song-paths");
  }

  // ========================================================================
  // Tagger Session API (Database-backed state)
  // ========================================================================

  /**
   * Get the current tagger session state
   */
  async getTaggerSession(): Promise<TaggerSessionResponse> {
    return this.request("/ferrotune/tagger/session");
  }

  /**
   * Update tagger session settings
   */
  async updateTaggerSession(
    updates: Partial<Omit<TaggerSessionResponse, "trackIds">>,
  ): Promise<void> {
    await this.request("/ferrotune/tagger/session", {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
  }

  /**
   * Clear the tagger session (tracks and edits)
   */
  async clearTaggerSession(): Promise<void> {
    await this.request("/ferrotune/tagger/session", {
      method: "DELETE",
    });
  }

  /**
   * Set the tracks in the tagger session (replaces existing)
   */
  async setTaggerSessionTracks(
    tracks: Array<{ id: string; trackType: string }>,
  ): Promise<void> {
    await this.request("/ferrotune/tagger/session/tracks", {
      method: "PUT",
      body: JSON.stringify({ tracks }),
    });
  }

  /**
   * Get all pending edits for the tagger session
   */
  async getTaggerPendingEdits(): Promise<TaggerPendingEditsResponse> {
    return this.request("/ferrotune/tagger/session/edits");
  }

  // NOTE: Bulk updateTaggerPendingEdits was removed.
  // Use updateTaggerEdit for individual track edits instead.

  /**
   * Clear all pending edits
   */
  async clearTaggerPendingEdits(): Promise<void> {
    await this.request("/ferrotune/tagger/session/edits", {
      method: "DELETE",
    });
  }

  /**
   * Save pending edits for tracks by reading from database.
   * This is the primary save method - reads edits from the server and applies them.
   * Handles both library tracks (tag updates, renames) and staged files (move to library).
   */
  async saveTaggerPendingEdits(
    trackIds: string[],
    pathOverrides?: Record<string, string>,
    targetMusicFolderId?: number,
  ): Promise<{
    success: boolean;
    savedCount: number;
    errors: Array<{ trackId: string; error: string }>;
    rescanRecommended: boolean;
    newSongPaths: string[];
  }> {
    return this.request("/ferrotune/tagger/session/save", {
      method: "POST",
      body: JSON.stringify({
        trackIds,
        pathOverrides: pathOverrides ?? {},
        targetMusicFolderId: targetMusicFolderId ?? null,
      }),
    });
  }

  /**
   * Save pending edits for tracks with streaming progress updates.
   * Uses Server-Sent Events to stream progress as each track is saved.
   * Returns an async generator that yields progress events.
   */
  async *saveTaggerPendingEditsStream(
    trackIds: string[],
    pathOverrides?: Record<string, string>,
    targetMusicFolderId?: number,
  ): AsyncGenerator<SaveProgressEvent> {
    const url = this.buildAdminUrl("/ferrotune/tagger/session/save-stream");

    // Build auth header
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    const authorization = this.getAuthorizationHeader();
    if (authorization) {
      headers["Authorization"] = authorization;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        trackIds,
        pathOverrides: pathOverrides ?? {},
        targetMusicFolderId: targetMusicFolderId ?? null,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to save: ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data && data !== "keep-alive") {
              try {
                const event = JSON.parse(data) as SaveProgressEvent;
                yield event;
              } catch {
                // Ignore parsing errors
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Get all tagger scripts
   */
  async getTaggerScripts(): Promise<TaggerScriptsResponse> {
    return this.request("/ferrotune/tagger/scripts");
  }

  /**
   * Save all tagger scripts (replaces existing)
   */
  async saveTaggerScripts(scripts: TaggerScriptData[]): Promise<void> {
    await this.request("/ferrotune/tagger/scripts", {
      method: "PUT",
      body: JSON.stringify(scripts),
    });
  }

  /**
   * Delete a tagger script
   */
  async deleteTaggerScript(scriptId: string): Promise<void> {
    await this.request(
      `/ferrotune/tagger/scripts/${encodeURIComponent(scriptId)}`,
      {
        method: "DELETE",
      },
    );
  }

  // ========================================================================
  // Tagger Session CRUD API (granular operations)
  // ========================================================================

  /**
   * Add tracks to the session (append)
   */
  async addTaggerTracks(
    tracks: Array<{ id: string; trackType: string }>,
  ): Promise<void> {
    await this.request("/ferrotune/tagger/session/tracks", {
      method: "POST",
      body: JSON.stringify({ tracks }),
    });
  }

  /**
   * Remove a single track from the session
   */
  async removeTaggerTrack(trackId: string): Promise<void> {
    await this.request(
      `/ferrotune/tagger/session/tracks/${encodeURIComponent(trackId)}`,
      {
        method: "DELETE",
      },
    );
  }

  /**
   * Remove multiple tracks from the session
   */
  async removeTaggerTracks(trackIds: string[]): Promise<void> {
    await this.request("/ferrotune/tagger/session/tracks/remove", {
      method: "POST",
      body: JSON.stringify({ trackIds }),
    });
  }

  /**
   * Update or create a pending edit for a single track (upsert)
   */
  async updateTaggerEdit(
    trackId: string,
    edit: {
      editedTags: Record<string, string>;
      computedPath: string | null;
      coverArtRemoved?: boolean;
    },
  ): Promise<void> {
    await this.request(
      `/ferrotune/tagger/session/edits/${encodeURIComponent(trackId)}`,
      {
        method: "PUT",
        body: JSON.stringify(edit),
      },
    );
  }

  /**
   * Delete a pending edit for a single track
   */
  async deleteTaggerEdit(trackId: string): Promise<void> {
    await this.request(
      `/ferrotune/tagger/session/edits/${encodeURIComponent(trackId)}`,
      {
        method: "DELETE",
      },
    );
  }

  /**
   * Upload cover art for a track (multipart binary)
   */
  async uploadTaggerCoverArt(
    trackId: string,
    file: File | Blob,
  ): Promise<void> {
    const formData = new FormData();
    formData.append("file", file);

    const url = this.buildAdminUrl(
      `/ferrotune/tagger/session/edits/${encodeURIComponent(trackId)}/cover`,
    );

    const headers = this.getAuthHeaders();

    const response = await fetch(url, {
      method: "PUT",
      headers,
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Failed to upload cover art: ${response.statusText}`);
    }
  }

  /**
   * Remove cover art for a track
   */
  async deleteTaggerCoverArt(trackId: string): Promise<void> {
    await this.request(
      `/ferrotune/tagger/session/edits/${encodeURIComponent(trackId)}/cover`,
      {
        method: "DELETE",
      },
    );
  }

  /**
   * Get the URL for fetching cover art for a track.
   * Use this URL directly in img src or fetch manually.
   * Includes auth params since img src doesn't send Authorization headers.
   */
  getTaggerCoverArtUrl(trackId: string): string {
    const params = new URLSearchParams();
    // Include auth params for browser img requests (no Authorization header)
    if (this.username && this.password) {
      params.set("u", this.username);
      params.set("p", this.password);
    } else if (this.apiKey) {
      params.set("apiKey", this.apiKey);
    }
    params.set("v", API_VERSION);
    params.set("c", CLIENT_NAME);

    return `${this.serverUrl}/ferrotune/tagger/session/edits/${encodeURIComponent(trackId)}/cover?${params.toString()}`;
  }

  /**
   * Upload replacement audio for a library track (multipart binary).
   * The replacement file will be staged and applied when the track is saved.
   * Can also import tags and/or cover art from the file.
   */
  async uploadTaggerReplacementAudio(
    trackId: string,
    file: File,
    options?: ImportFromFileOptions,
  ): Promise<ReplacementAudioUploadResponse> {
    const formData = new FormData();
    formData.append("file", file);

    if (options) {
      formData.append(
        "options",
        JSON.stringify({
          importAudio: options.importAudio ?? true,
          importTags: options.importTags ?? false,
          importCoverArt: options.importCoverArt ?? false,
        }),
      );
    }

    const url = this.buildAdminUrl(
      `/ferrotune/tagger/session/edits/${encodeURIComponent(trackId)}/replacement-audio`,
    );

    const headers = this.getAuthHeaders();

    const response = await fetch(url, {
      method: "PUT",
      headers,
      body: formData,
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new FerrotuneApiError(
        response.status,
        data.error ||
          `Failed to upload replacement audio: ${response.statusText}`,
      );
    }

    return response.json();
  }

  /**
   * Remove staged replacement audio for a track
   */
  async deleteTaggerReplacementAudio(trackId: string): Promise<void> {
    await this.request(
      `/ferrotune/tagger/session/edits/${encodeURIComponent(trackId)}/replacement-audio`,
      {
        method: "DELETE",
      },
    );
  }

  /**
   * Get stream URL for replacement audio (for preview playback).
   * Includes auth params since Audio elements can't use HTTP headers.
   */
  getReplacementAudioStreamUrl(trackId: string): string {
    const params = new URLSearchParams();
    // Add auth params for Audio element compatibility
    if (this.username && this.password) {
      params.set("u", this.username);
      params.set("p", this.password);
    } else if (this.apiKey) {
      params.set("apiKey", this.apiKey);
    }
    params.set("v", API_VERSION);
    params.set("c", CLIENT_NAME);

    return `${this.serverUrl}/ferrotune/tagger/session/edits/${encodeURIComponent(trackId)}/replacement-audio/stream?${params.toString()}`;
  }

  // === Playlist Folder Management ===

  /**
   * Create a new playlist folder
   * @param name - Name for the new folder
   * @param parentId - Optional parent folder ID (null/undefined = root level)
   */
  async createPlaylistFolder(
    name: string,
    parentId?: string | null,
  ): Promise<PlaylistFolderResponse> {
    return this.request<PlaylistFolderResponse>("/ferrotune/playlist-folders", {
      method: "POST",
      body: JSON.stringify({
        name,
        parentId: parentId ?? null,
      }),
    });
  }

  /**
   * Move a playlist to a folder
   * @param playlistId - The playlist ID to move
   * @param folderId - Target folder ID (null to move to root)
   */
  async movePlaylistToFolder(
    playlistId: string,
    folderId: string | null,
  ): Promise<void> {
    await this.request(
      `/ferrotune/playlists/${encodeURIComponent(playlistId)}/move`,
      {
        method: "PATCH",
        body: JSON.stringify({ folderId }),
      },
    );
  }

  /**
   * Delete a playlist folder
   * @param folderId - The folder ID to delete
   */
  async deletePlaylistFolder(folderId: string): Promise<void> {
    await this.request(
      `/ferrotune/playlist-folders/${encodeURIComponent(folderId)}`,
      {
        method: "DELETE",
      },
    );
  }

  /**
   * Update a playlist folder (rename or move to different parent)
   * @param folderId - The folder ID to update
   * @param options.name - New name for the folder
   * @param options.parentId - New parent folder ID (null to move to root, undefined to not change)
   */
  async updatePlaylistFolder(
    folderId: string,
    options: {
      name?: string;
      parentId?: string | null; // null = move to root, undefined = don't change
    },
  ): Promise<PlaylistFolderResponse> {
    // Build the request body - only include fields that are being changed
    const body: { name?: string; parentId?: string | null } = {};
    if (options.name !== undefined) {
      body.name = options.name;
    }
    if (options.parentId !== undefined) {
      // Wrap in double-option for the Rust API convention
      body.parentId = options.parentId;
    }

    return this.request<PlaylistFolderResponse>(
      `/ferrotune/playlist-folders/${encodeURIComponent(folderId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(body),
      },
    );
  }

  /**
   * Move a playlist folder to a different parent folder
   */
  async movePlaylistFolder(
    folderId: string,
    targetParentId: string | null,
  ): Promise<PlaylistFolderResponse> {
    return this.updatePlaylistFolder(folderId, { parentId: targetParentId });
  }

  // === Playlist Folder Cover Art ===

  /**
   * Upload cover art for a playlist folder (binary image data)
   */
  async uploadPlaylistFolderCover(
    folderId: string,
    file: File | Blob,
  ): Promise<void> {
    const url = this.buildAdminUrl(
      `/ferrotune/playlist-folders/${encodeURIComponent(folderId)}/cover`,
    );

    const headers = this.getAuthHeaders();

    // Send raw binary data (not FormData)
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        ...headers,
        "Content-Type": file.type || "application/octet-stream",
      },
      body: file,
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(
        data.error || `Failed to upload cover art: ${response.statusText}`,
      );
    }
  }

  /**
   * Delete cover art for a playlist folder
   */
  async deletePlaylistFolderCover(folderId: string): Promise<void> {
    await this.request(
      `/ferrotune/playlist-folders/${encodeURIComponent(folderId)}/cover`,
      {
        method: "DELETE",
      },
    );
  }

  /**
   * Get the URL for playlist folder cover art
   * @param folderId - The folder ID (without pf- prefix - we add it)
   * @param size - Optional size tier
   * @param cacheBuster - Optional cache buster to force browser refresh
   */
  getPlaylistFolderCoverUrl(
    folderId: string,
    size?: "small" | "medium" | "large",
    cacheBuster?: string,
  ): string {
    // Use pf- prefix for playlist folder cover art
    return this.getCoverArtUrl(`pf-${folderId}`, size, cacheBuster);
  }
}

// Singleton instance - will be initialized when user connects
let clientInstance: FerrotuneClient | null = null;

export function initializeClient(
  connection: ServerConnection,
): FerrotuneClient {
  clientInstance = new FerrotuneClient(connection);
  return clientInstance;
}

export function getClient(): FerrotuneClient | null {
  return clientInstance;
}

export function clearClient(): void {
  clientInstance = null;
}
