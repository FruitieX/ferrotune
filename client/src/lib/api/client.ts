import type { PlaylistFoldersResponse } from "./generated/PlaylistFoldersResponse";
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
} from "./types";
import type { DirectoryPagedResponse } from "./generated/DirectoryPagedResponse";
import type { GetDirectoryPagedParams } from "./generated/GetDirectoryPagedParams";
import type { ServerConfigResponse } from "./generated/ServerConfigResponse";
import type { UpdateServerConfigRequest } from "./generated/UpdateServerConfigRequest";
import type { PeriodReviewResponse } from "./generated/PeriodReviewResponse";
import type { ImportPlaylistRequest } from "./generated/ImportPlaylistRequest";
import type { ImportPlaylistResponse } from "./generated/ImportPlaylistResponse";
import type { PlaylistEntriesResponse } from "./generated/PlaylistEntriesResponse";
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
import type { ImportScrobblesRequest } from "./generated/ImportScrobblesRequest";
import type { ImportScrobblesResponse } from "./generated/ImportScrobblesResponse";
import type { GetPlayCountsRequest } from "./generated/GetPlayCountsRequest";
import type { GetPlayCountsResponse } from "./generated/GetPlayCountsResponse";
import type { SmartPlaylistsResponse } from "./generated/SmartPlaylistsResponse";
import type { SmartPlaylistInfo } from "./generated/SmartPlaylistInfo";
import type { SmartPlaylistSongsResponse } from "./generated/SmartPlaylistSongsResponse";
import type { CreateSmartPlaylistRequest } from "./generated/CreateSmartPlaylistRequest";
import type { CreateSmartPlaylistResponse } from "./generated/CreateSmartPlaylistResponse";
import type { UpdateSmartPlaylistRequest } from "./generated/UpdateSmartPlaylistRequest";
import { PlaylistInFolder } from "./generated";

// Ping response is empty
type PingResponse = Record<string, never>;

const API_VERSION = "1.16.1";
const CLIENT_NAME = "ferrotune-web";

export class FerrotuneApiError extends Error {
  code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = "FerrotuneApiError";
    this.code = code;
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

  private buildUrl(
    endpoint: string,
    params: Record<string, string | number | boolean | null | undefined> = {},
  ): string {
    const url = new URL(`${this.serverUrl}/rest/${endpoint}`);

    // Add required params
    url.searchParams.set("v", API_VERSION);
    url.searchParams.set("c", CLIENT_NAME);
    url.searchParams.set("f", "json");

    // Add auth params
    if (this.apiKey) {
      url.searchParams.set("apiKey", this.apiKey);
    } else if (this.username && this.password) {
      url.searchParams.set("u", this.username);
      url.searchParams.set("p", this.password);
    }

    // Add custom params (skip null and undefined)
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }

    return url.toString();
  }

  // System endpoints
  async ping(): Promise<PingResponse> {
    return this.request<PingResponse>("/ferrotune/ping");
  }

  async getMusicFolders(): Promise<MusicFoldersResponse> {
    return this.request<MusicFoldersResponse>("/ferrotune/music-folders");
  }

  // Browse endpoints
  async getArtists(musicFolderId?: number): Promise<ArtistsResponse> {
    const params = new URLSearchParams();
    if (musicFolderId !== undefined) {
      params.set("musicFolderId", String(musicFolderId));
    }
    const queryString = params.toString();
    const endpoint = queryString
      ? `/ferrotune/artists?${queryString}`
      : "/ferrotune/artists";
    return this.request<ArtistsResponse>(endpoint);
  }

  async getArtist(
    id: string,
    options?: { sort?: string; sortDir?: string; filter?: string },
  ): Promise<ArtistDetailResponse> {
    const params = new URLSearchParams();
    if (options?.sort) params.set("sort", options.sort);
    if (options?.sortDir) params.set("sortDir", options.sortDir);
    if (options?.filter) params.set("filter", options.filter);

    const queryString = params.toString();
    const endpoint = queryString
      ? `/ferrotune/artists/${encodeURIComponent(id)}?${queryString}`
      : `/ferrotune/artists/${encodeURIComponent(id)}`;

    return this.request<ArtistDetailResponse>(endpoint);
  }

  async getAlbum(
    id: string,
    options?: { sort?: string; sortDir?: string; filter?: string },
  ): Promise<AlbumDetailResponse> {
    const params = new URLSearchParams();
    if (options?.sort) params.set("sort", options.sort);
    if (options?.sortDir) params.set("sortDir", options.sortDir);
    if (options?.filter) params.set("filter", options.filter);

    const queryString = params.toString();
    const endpoint = queryString
      ? `/ferrotune/albums/${encodeURIComponent(id)}?${queryString}`
      : `/ferrotune/albums/${encodeURIComponent(id)}`;

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
    const params = new URLSearchParams();
    if (musicFolderId !== undefined) {
      params.set("musicFolderId", String(musicFolderId));
    }
    const queryString = params.toString();
    const endpoint = queryString
      ? `/ferrotune/indexes?${queryString}`
      : "/ferrotune/indexes";
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
    const queryParams = new URLSearchParams();
    if (params.libraryId != null)
      queryParams.set("libraryId", String(params.libraryId));
    if (params.path != null) queryParams.set("path", params.path);
    if (params.count != null) queryParams.set("count", String(params.count));
    if (params.offset != null) queryParams.set("offset", String(params.offset));
    if (params.sort != null) queryParams.set("sort", params.sort);
    if (params.sortDir != null) queryParams.set("sortDir", params.sortDir);
    if (params.filter != null) queryParams.set("filter", params.filter);
    if (params.foldersOnly != null)
      queryParams.set("foldersOnly", String(params.foldersOnly));
    if (params.filesOnly != null)
      queryParams.set("filesOnly", String(params.filesOnly));
    if (params.inlineImages != null)
      queryParams.set("inlineImages", params.inlineImages);

    const queryString = queryParams.toString();
    const endpoint = queryString
      ? `/ferrotune/directory?${queryString}`
      : "/ferrotune/directory";
    return this.request<DirectoryPagedResponse>(endpoint);
  }

  // List endpoints
  // AlbumListParams requires 'type', other fields are optional
  async getAlbumList2(
    params: Pick<AlbumListParams, "type"> &
      Partial<Omit<AlbumListParams, "type">> & {
        inlineImages?: "small" | "medium";
      },
  ): Promise<AlbumListResponse> {
    const queryParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        queryParams.set(key, String(value));
      }
    }
    const queryString = queryParams.toString();
    const endpoint = queryString
      ? `/ferrotune/albums?${queryString}`
      : "/ferrotune/albums";

    // Ferrotune API returns { album: [...], total: ... }
    // but client expects { albumList2: { album: [...] } }
    const res = await this.request<{ album: unknown[]; total?: number }>(
      endpoint,
    );

    return {
      albumList2: {
        album: res.album,
      },
    } as unknown as AlbumListResponse;
  }

  async getRandomSongs(
    params: Partial<RandomSongsParams> = {},
  ): Promise<RandomSongsResponse> {
    const queryParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        queryParams.set(key, String(value));
      }
    }
    const queryString = queryParams.toString();
    const endpoint = queryString
      ? `/ferrotune/songs/random?${queryString}`
      : "/ferrotune/songs/random";

    return this.request<RandomSongsResponse>(endpoint);
  }

  async getSongsByGenre(
    genre: string,
    params: Partial<Omit<SongsByGenreParams, "genre">> = {},
  ): Promise<SongsByGenreResponse> {
    const queryParams = new URLSearchParams();
    queryParams.set("genre", genre);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        queryParams.set(key, String(value));
      }
    }
    const queryString = queryParams.toString();
    const endpoint = queryString
      ? `/ferrotune/songs/by-genre?${queryString}`
      : "/ferrotune/songs/by-genre";

    return this.request<SongsByGenreResponse>(endpoint);
  }

  // Search endpoint
  // SearchParams requires 'query', other fields are optional
  async search3(
    params: Pick<SearchParams, "query"> & Partial<Omit<SearchParams, "query">>,
  ): Promise<SearchResponse> {
    const queryParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        queryParams.set(key, String(value));
      }
    }
    const queryString = queryParams.toString();
    const endpoint = queryString
      ? `/ferrotune/search?${queryString}`
      : "/ferrotune/search";

    // Ferrotune API returns { searchResult: {...} }
    // but client expects { searchResult3: {...} }
    // FIXME: This is a temporary workaround
    const res = await this.request<{ searchResult: unknown }>(endpoint);

    return {
      searchResult3: res.searchResult,
    } as unknown as SearchResponse;
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

  async scrobble(id: string, time?: number, submission = true): Promise<void> {
    await this.request("/ferrotune/scrobbles", {
      method: "POST",
      body: JSON.stringify({ id, time, submission }),
    });
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
      duration: 0,
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
    const params = new URLSearchParams();
    if (options?.sort) params.set("sort", options.sort);
    if (options?.sortDir) params.set("sortDir", options.sortDir);
    if (options?.filter) params.set("filter", options.filter);
    if (options?.offset !== undefined)
      params.set("offset", String(options.offset));
    if (options?.count !== undefined)
      params.set("count", String(options.count));

    // Always request small images for list views
    params.set("inlineImages", "small");

    const queryString = params.toString();
    const endpoint = queryString
      ? `/ferrotune/playlists/${encodeURIComponent(id)}?${queryString}`
      : `/ferrotune/playlists/${encodeURIComponent(id)}`;

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
    const queryParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        queryParams.set(key, String(value));
      }
    }
    const queryString = queryParams.toString();
    const endpoint = queryString
      ? `/ferrotune/history?${queryString}`
      : "/ferrotune/history";

    // Ferrotune API returns { entry: [...], total: ... }
    // but client expects { playHistory: { entry: [...], total: ... } }
    const res = await this.request<{ entry: unknown[]; total?: number }>(
      endpoint,
    );

    return {
      playHistory: {
        entry: res.entry,
        total: res.total,
      },
    } as unknown as PlayHistoryResponse;
  }

  // Media URL builders (no fetch, returns URL string)
  getStreamUrl(id: string, maxBitRate?: number): string {
    const params = new URLSearchParams();
    // Add auth params manually
    if (this.username && this.password) {
      params.set("u", this.username);
      params.set("p", this.password);
    } else if (this.apiKey) {
      params.set("k", this.apiKey); // OpenSubsonic usually calls it apiKey? Or t+s.
      // Admin API uses basic auth or standard OS params.
      // Let's use `u` & `p` as standard fallback.
      // Or better, let's look at `buildUrl`:
      // if (this.apiKey) url.searchParams.set("apiKey", this.apiKey);
      params.set("apiKey", this.apiKey);
    }

    params.set("v", API_VERSION);
    params.set("c", CLIENT_NAME);
    params.set("id", id);
    if (maxBitRate) params.set("maxBitRate", String(maxBitRate));

    return `${this.serverUrl}/ferrotune/stream?${params.toString()}`;
  }

  /**
   * Get cover art URL for a given ID
   * @param id - The cover art ID (album, song, artist, or playlist)
   * @param size - Size tier: "small" (for rows/lists), "medium" (for cards), or "large" (original)
   *               For backwards compatibility, numeric sizes are also accepted and mapped to tiers
   */
  getCoverArtUrl(
    id: string,
    size?: "small" | "medium" | "large" | number,
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
    params.set("id", id);

    return `${this.serverUrl}/ferrotune/download?${params.toString()}`;
  }

  // Admin API methods
  private buildAdminUrl(endpoint: string): string {
    return `${this.serverUrl}${endpoint}`;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = this.buildAdminUrl(endpoint);

    // Build auth header
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };

    if (this.username && this.password) {
      headers["Authorization"] =
        `Basic ${btoa(`${this.username}:${this.password}`)}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `HTTP error: ${response.status}`);
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
   * Get all song IDs matching the given search/filter criteria.
   * Useful for bulk operations like "select all matching songs".
   */
  async getSongIds(
    params: Partial<SearchParams> = {},
  ): Promise<SongIdsResponse> {
    const searchParams = new URLSearchParams();

    // Add search parameters (filter out null and undefined)
    if (params.query != null) searchParams.set("query", params.query);
    if (params.songSort != null) searchParams.set("songSort", params.songSort);
    if (params.songSortDir != null)
      searchParams.set("songSortDir", params.songSortDir);
    if (params.minYear != null)
      searchParams.set("minYear", String(params.minYear));
    if (params.maxYear != null)
      searchParams.set("maxYear", String(params.maxYear));
    if (params.genre != null) searchParams.set("genre", params.genre);
    if (params.minDuration != null)
      searchParams.set("minDuration", String(params.minDuration));
    if (params.maxDuration != null)
      searchParams.set("maxDuration", String(params.maxDuration));
    if (params.minRating != null)
      searchParams.set("minRating", String(params.minRating));
    if (params.maxRating != null)
      searchParams.set("maxRating", String(params.maxRating));
    if (params.starredOnly != null)
      searchParams.set("starredOnly", String(params.starredOnly));
    if (params.minPlayCount != null)
      searchParams.set("minPlayCount", String(params.minPlayCount));
    if (params.maxPlayCount != null)
      searchParams.set("maxPlayCount", String(params.maxPlayCount));
    if (params.shuffleExcludedOnly != null)
      searchParams.set(
        "shuffleExcludedOnly",
        String(params.shuffleExcludedOnly),
      );
    if (params.minBitrate != null)
      searchParams.set("minBitrate", String(params.minBitrate));
    if (params.maxBitrate != null)
      searchParams.set("maxBitrate", String(params.maxBitrate));
    if (params.addedAfter != null)
      searchParams.set("addedAfter", params.addedAfter);
    if (params.addedBefore != null)
      searchParams.set("addedBefore", params.addedBefore);

    const queryString = searchParams.toString();
    const endpoint = queryString
      ? `/ferrotune/songs/ids?${queryString}`
      : "/ferrotune/songs/ids";
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
    const params = new URLSearchParams();
    if (options?.offset !== undefined)
      params.set("offset", options.offset.toString());
    if (options?.count !== undefined)
      params.set("count", options.count.toString());
    if (options?.sort !== undefined) params.set("sort", options.sort);
    if (options?.sortDir !== undefined) params.set("sortDir", options.sortDir);
    if (options?.filter !== undefined) params.set("filter", options.filter);
    if (options?.entryType !== undefined)
      params.set("entryType", options.entryType);
    if (options?.inlineImages !== undefined)
      params.set("inlineImages", options.inlineImages);
    const query = params.toString();
    return this.request(
      `/ferrotune/playlists/${encodeURIComponent(playlistId)}/songs${query ? `?${query}` : ""}`,
    );
  }

  /**
   * @deprecated Use getPlaylistSongs instead which returns songs with entries interleaved
   */
  async getPlaylistEntries(
    playlistId: string,
  ): Promise<PlaylistEntriesResponse> {
    return this.request(
      `/ferrotune/playlists/${encodeURIComponent(playlistId)}/entries`,
    );
  }

  // Listening statistics (Admin API)
  async logListening(
    songId: string,
    durationSeconds: number,
    sessionId?: number,
  ): Promise<{ success: boolean; sessionId: number }> {
    return this.request("/ferrotune/listening", {
      method: "POST",
      body: JSON.stringify({ songId, durationSeconds, sessionId }),
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
    const params = new URLSearchParams();
    if (year !== undefined) params.set("year", year.toString());
    if (month !== undefined) params.set("month", month.toString());
    if (inlineImages !== undefined) params.set("inlineImages", inlineImages);
    const query = params.toString();
    return this.request(
      `/ferrotune/listening/review${query ? `?${query}` : ""}`,
    );
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

  async getPlayCounts(songIds: string[]): Promise<GetPlayCountsResponse> {
    return this.request("/ferrotune/scrobbles/counts", {
      method: "POST",
      body: JSON.stringify({ songIds } as GetPlayCountsRequest),
    });
  }

  // Streaming waveform URL (Admin API - returns URL for SSE endpoint)
  getWaveformStreamUrl(songId: string, resolution: number = 200): string {
    // Build URL with resolution param
    const baseUrl = this.buildAdminUrl(
      `/ferrotune/songs/${encodeURIComponent(songId)}/waveform/stream`,
    );
    const params = new URLSearchParams({
      resolution: resolution.toString(),
    });
    return `${baseUrl}?${params.toString()}`;
  }

  // Get auth headers for streaming requests
  getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.username && this.password) {
      headers["Authorization"] =
        `Basic ${btoa(`${this.username}:${this.password}`)}`;
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
    const url = this.buildAdminUrl(
      `/ferrotune/songs/${encodeURIComponent(songId)}/shuffle-exclude`,
    );

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.username && this.password) {
      headers["Authorization"] =
        `Basic ${btoa(`${this.username}:${this.password}`)}`;
    }

    const response = await fetch(url, {
      method: "PUT",
      headers,
      body: JSON.stringify({ excluded }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `HTTP error: ${response.status}`);
    }

    return response.json();
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
    } = {},
  ): Promise<GetQueueResponse> {
    const query = new URLSearchParams();
    if (params.offset !== undefined) query.set("offset", String(params.offset));
    if (params.limit !== undefined) query.set("limit", String(params.limit));
    if (params.inlineImages !== undefined)
      query.set("inlineImages", params.inlineImages);
    const queryStr = query.toString();
    return this.request(`/ferrotune/queue${queryStr ? `?${queryStr}` : ""}`);
  }

  /**
   * Get songs around the current position
   */
  async getQueueCurrentWindow(
    radius: number = 20,
    inlineImages?: "small" | "medium",
  ): Promise<GetQueueResponse> {
    const params = new URLSearchParams();
    params.set("radius", String(radius));
    if (inlineImages !== undefined) params.set("inlineImages", inlineImages);
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
  }): Promise<QueueSuccessResponse> {
    return this.request("/ferrotune/queue/add", {
      method: "POST",
      body: JSON.stringify({
        songIds: params.songIds,
        position: params.position,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
      }),
    });
  }

  /**
   * Remove a song from the queue at a position
   */
  async removeFromServerQueue(position: number): Promise<QueueSuccessResponse> {
    return this.request(`/ferrotune/queue/${position}`, {
      method: "DELETE",
    });
  }

  /**
   * Move a song from one position to another
   */
  async moveInServerQueue(
    fromPosition: number,
    toPosition: number,
  ): Promise<QueueSuccessResponse> {
    return this.request("/ferrotune/queue/move", {
      method: "POST",
      body: JSON.stringify({
        fromPosition,
        toPosition,
      }),
    });
  }

  /**
   * Toggle shuffle mode
   */
  async toggleServerShuffle(enabled: boolean): Promise<QueueSuccessResponse> {
    return this.request("/ferrotune/queue/shuffle", {
      method: "POST",
      body: JSON.stringify({ enabled }),
    });
  }

  /**
   * Update the current playback position
   */
  async updateServerQueuePosition(
    currentIndex: number,
    positionMs: number = 0,
  ): Promise<QueueSuccessResponse> {
    return this.request("/ferrotune/queue/position", {
      method: "POST",
      body: JSON.stringify({
        currentIndex,
        positionMs,
      }),
    });
  }

  /**
   * Update repeat mode
   */
  async updateServerRepeatMode(
    mode: "off" | "all" | "one",
  ): Promise<QueueSuccessResponse> {
    return this.request("/ferrotune/queue/repeat", {
      method: "POST",
      body: JSON.stringify({ mode }),
    });
  }

  /**
   * Clear the entire queue
   */
  async clearServerQueue(): Promise<QueueSuccessResponse> {
    return this.request("/ferrotune/queue", {
      method: "DELETE",
    });
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
