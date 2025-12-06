import type {
  SubsonicResponse,
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
  PlayQueueResponse,
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
  QueueSuccessResponse,
  IndexesResponse,
  DirectoryResponse,
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
} from "./types";
import type { DirectoryPagedResponse } from "./generated/DirectoryPagedResponse";
import type { GetDirectoryPagedParams } from "./generated/GetDirectoryPagedParams";
import type { ServerConfigResponse } from "./generated/ServerConfigResponse";
import type { UpdateServerConfigRequest } from "./generated/UpdateServerConfigRequest";
import type { PeriodReviewResponse } from "./generated/PeriodReviewResponse";

// Ping response is empty
interface PingResponse {
  // Empty for ping
}

const API_VERSION = "1.16.1";
const CLIENT_NAME = "ferrotune-web";

export class SubsonicApiError extends Error {
  code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = "SubsonicApiError";
    this.code = code;
  }
}

export class SubsonicClient {
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

  private buildUrl(endpoint: string, params: Record<string, string | number | boolean | null | undefined> = {}): string {
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

  private async request<T>(endpoint: string, params: Record<string, string | number | boolean | null | undefined> = {}): Promise<T> {
    const url = this.buildUrl(endpoint, params);
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    const data = (await response.json()) as SubsonicResponse<T>;

    if (data["subsonic-response"].status === "failed") {
      const error = data["subsonic-response"].error!;
      throw new SubsonicApiError(error.code, error.message);
    }

    return data["subsonic-response"] as T;
  }

  // System endpoints
  async ping(): Promise<PingResponse> {
    return this.request<PingResponse>("ping");
  }

  async getMusicFolders(): Promise<MusicFoldersResponse> {
    return this.request<MusicFoldersResponse>("getMusicFolders");
  }

  // Browse endpoints
  async getArtists(musicFolderId?: number): Promise<ArtistsResponse> {
    return this.request<ArtistsResponse>("getArtists", { musicFolderId });
  }

  async getArtist(
    id: string,
    options?: { sort?: string; sortDir?: string; filter?: string }
  ): Promise<ArtistDetailResponse> {
    return this.request<ArtistDetailResponse>("getArtist", {
      id,
      sort: options?.sort,
      sortDir: options?.sortDir,
      filter: options?.filter,
    });
  }

  async getAlbum(
    id: string,
    options?: { sort?: string; sortDir?: string; filter?: string }
  ): Promise<AlbumDetailResponse> {
    return this.request<AlbumDetailResponse>("getAlbum", {
      id,
      sort: options?.sort,
      sortDir: options?.sortDir,
      filter: options?.filter,
    });
  }

  async getSong(id: string): Promise<SongDetailResponse> {
    return this.request<SongDetailResponse>("getSong", { id });
  }

  async getGenres(): Promise<GenresResponse> {
    return this.request<GenresResponse>("getGenres");
  }

  // Directory browsing endpoints
  async getIndexes(musicFolderId?: number): Promise<IndexesResponse> {
    return this.request<IndexesResponse>("getIndexes", { musicFolderId });
  }

  async getMusicDirectory(id: string): Promise<DirectoryResponse> {
    return this.request<DirectoryResponse>("getMusicDirectory", { id });
  }

  // Paginated directory browsing (Ferrotune extension)
  async getDirectoryPaged(params: Partial<GetDirectoryPagedParams> = {}): Promise<DirectoryPagedResponse> {
    const queryParams = new URLSearchParams();
    if (params.id != null) queryParams.set("id", params.id);
    if (params.count != null) queryParams.set("count", String(params.count));
    if (params.offset != null) queryParams.set("offset", String(params.offset));
    if (params.sort != null) queryParams.set("sort", params.sort);
    if (params.sortDir != null) queryParams.set("sortDir", params.sortDir);
    if (params.filter != null) queryParams.set("filter", params.filter);
    if (params.foldersOnly != null) queryParams.set("foldersOnly", String(params.foldersOnly));
    if (params.filesOnly != null) queryParams.set("filesOnly", String(params.filesOnly));
    
    const queryString = queryParams.toString();
    const endpoint = queryString ? `/ferrotune/directory?${queryString}` : "/ferrotune/directory";
    return this.adminRequest<DirectoryPagedResponse>(endpoint);
  }

  // List endpoints
  // AlbumListParams requires 'type', other fields are optional
  async getAlbumList2(params: Pick<AlbumListParams, 'type'> & Partial<Omit<AlbumListParams, 'type'>>): Promise<AlbumListResponse> {
    return this.request<AlbumListResponse>("getAlbumList2", { ...params });
  }

  async getRandomSongs(params: Partial<RandomSongsParams> = {}): Promise<RandomSongsResponse> {
    return this.request<RandomSongsResponse>("getRandomSongs", { ...params });
  }

  async getSongsByGenre(genre: string, params: Partial<Omit<SongsByGenreParams, 'genre'>> = {}): Promise<SongsByGenreResponse> {
    return this.request<SongsByGenreResponse>("getSongsByGenre", { genre, ...params });
  }

  // Search endpoint
  // SearchParams requires 'query', other fields are optional
  async search3(params: Pick<SearchParams, 'query'> & Partial<Omit<SearchParams, 'query'>>): Promise<SearchResponse> {
    return this.request<SearchResponse>("search3", { ...params });
  }

  // Starring endpoints
  async star(params: { id?: string | string[]; albumId?: string | string[]; artistId?: string | string[] }): Promise<void> {
    const urlParams: Record<string, string> = {};
    
    // Handle array parameters - OpenSubsonic uses repeated params
    if (params.id) {
      const ids = Array.isArray(params.id) ? params.id : [params.id];
      ids.forEach((id, i) => urlParams[i === 0 ? "id" : `id`] = id);
    }
    if (params.albumId) {
      const ids = Array.isArray(params.albumId) ? params.albumId : [params.albumId];
      ids.forEach((id, i) => urlParams[i === 0 ? "albumId" : `albumId`] = id);
    }
    if (params.artistId) {
      const ids = Array.isArray(params.artistId) ? params.artistId : [params.artistId];
      ids.forEach((id, i) => urlParams[i === 0 ? "artistId" : `artistId`] = id);
    }

    await this.request("star", urlParams);
  }

  async unstar(params: { id?: string | string[]; albumId?: string | string[]; artistId?: string | string[] }): Promise<void> {
    const urlParams: Record<string, string> = {};
    
    if (params.id) {
      urlParams.id = Array.isArray(params.id) ? params.id[0] : params.id;
    }
    if (params.albumId) {
      urlParams.albumId = Array.isArray(params.albumId) ? params.albumId[0] : params.albumId;
    }
    if (params.artistId) {
      urlParams.artistId = Array.isArray(params.artistId) ? params.artistId[0] : params.artistId;
    }

    await this.request("unstar", urlParams);
  }

  async setRating(id: string, rating: number): Promise<void> {
    await this.request("setRating", { id, rating });
  }

  async getStarred2(): Promise<StarredResponse> {
    return this.request<StarredResponse>("getStarred2");
  }

  async scrobble(id: string, time?: number, submission = true): Promise<void> {
    await this.request("scrobble", { id, time, submission });
  }

  // Playlist endpoints
  async getPlaylists(): Promise<PlaylistsResponse> {
    return this.request<PlaylistsResponse>("getPlaylists");
  }

  async getPlaylist(id: string, options?: {
    sort?: string;
    sortDir?: string;
    filter?: string;
    offset?: number;
    count?: number;
  }): Promise<PlaylistWithSongsResponse> {
    return this.request<PlaylistWithSongsResponse>("getPlaylist", { 
      id,
      sort: options?.sort,
      sortDir: options?.sortDir,
      filter: options?.filter,
      offset: options?.offset,
      count: options?.count,
    });
  }

  async createPlaylist(params: { name: string; songId?: string[] }): Promise<PlaylistWithSongsResponse> {
    // Build URL manually to handle array parameters (same as updatePlaylist)
    const url = new URL(`${this.serverUrl}/rest/createPlaylist`);
    url.searchParams.set("v", API_VERSION);
    url.searchParams.set("c", CLIENT_NAME);
    url.searchParams.set("f", "json");
    
    if (this.apiKey) {
      url.searchParams.set("apiKey", this.apiKey);
    } else if (this.username && this.password) {
      url.searchParams.set("u", this.username);
      url.searchParams.set("p", this.password);
    }
    
    url.searchParams.set("name", params.name);
    
    // Handle array parameters - OpenSubsonic uses repeated params
    if (params.songId) {
      for (const songId of params.songId) {
        url.searchParams.append("songId", songId);
      }
    }
    
    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }
    
    const data = await response.json();
    if (data["subsonic-response"].status === "failed") {
      const error = data["subsonic-response"].error;
      throw new SubsonicApiError(error.code, error.message);
    }
    
    return data["subsonic-response"] as PlaylistWithSongsResponse;
  }

  async updatePlaylist(params: {
    playlistId: string;
    name?: string;
    comment?: string;
    public?: boolean;
    songIdToAdd?: string[];
    songIndexToRemove?: number[];
  }): Promise<void> {
    // Build URL manually to handle array parameters
    const url = new URL(`${this.serverUrl}/rest/updatePlaylist`);
    url.searchParams.set("v", API_VERSION);
    url.searchParams.set("c", CLIENT_NAME);
    url.searchParams.set("f", "json");
    
    if (this.apiKey) {
      url.searchParams.set("apiKey", this.apiKey);
    } else if (this.username && this.password) {
      url.searchParams.set("u", this.username);
      url.searchParams.set("p", this.password);
    }
    
    url.searchParams.set("playlistId", params.playlistId);
    if (params.name !== undefined) url.searchParams.set("name", params.name);
    if (params.comment !== undefined) url.searchParams.set("comment", params.comment);
    if (params.public !== undefined) url.searchParams.set("public", String(params.public));
    
    // Handle array parameters - OpenSubsonic uses repeated params
    if (params.songIdToAdd) {
      for (const songId of params.songIdToAdd) {
        url.searchParams.append("songIdToAdd", songId);
      }
    }
    if (params.songIndexToRemove) {
      for (const index of params.songIndexToRemove) {
        url.searchParams.append("songIndexToRemove", String(index));
      }
    }
    
    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }
    
    const data = await response.json();
    if (data["subsonic-response"].status === "failed") {
      const error = data["subsonic-response"].error;
      throw new SubsonicApiError(error.code, error.message);
    }
  }

  async deletePlaylist(id: string): Promise<void> {
    await this.request("deletePlaylist", { id });
  }

  // Play Queue endpoints
  async savePlayQueue(params: {
    songIds: string[];
    current?: string;
    position?: number;
  }): Promise<void> {
    // Use the Ferrotune Admin API endpoint (POST with JSON body)
    // This is more scalable than the OpenSubsonic endpoint which uses query params
    await this.adminRequest("/ferrotune/play-queue", {
      method: "POST",
      body: JSON.stringify({
        songIds: params.songIds,
        current: params.current,
        position: params.position,
      }),
    });
  }

  async getPlayQueue(): Promise<PlayQueueResponse> {
    return this.request<PlayQueueResponse>("getPlayQueue");
  }

  // Play History endpoints (Ferrotune extensions)
  async getPlayHistory(params: { 
    size?: number; 
    offset?: number;
    sort?: string;
    sortDir?: string;
    filter?: string;
  } = {}): Promise<PlayHistoryResponse> {
    return this.request<PlayHistoryResponse>("getPlayHistory", params);
  }

  // Media URL builders (no fetch, returns URL string)
  getStreamUrl(id: string, maxBitRate?: number): string {
    return this.buildUrl("stream", { id, maxBitRate });
  }

  getCoverArtUrl(id: string, size?: number): string {
    return this.buildUrl("getCoverArt", { id, size });
  }

  getDownloadUrl(id: string): string {
    return this.buildUrl("download", { id });
  }

  // Admin API methods
  private buildAdminUrl(endpoint: string): string {
    return `${this.serverUrl}${endpoint}`;
  }

  private async adminRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = this.buildAdminUrl(endpoint);

    // Build auth header
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };

    if (this.username && this.password) {
      headers["Authorization"] = `Basic ${btoa(`${this.username}:${this.password}`)}`;
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

    return response.json() as Promise<T>;
  }

  async deleteSongFromDatabase(id: string): Promise<{ success: boolean; message: string }> {
    return this.adminRequest(`/ferrotune/songs/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  /**
   * Get all song IDs matching the given search/filter criteria.
   * Useful for bulk operations like "select all matching songs".
   */
  async getSongIds(params: Partial<SearchParams> = {}): Promise<SongIdsResponse> {
    const searchParams = new URLSearchParams();
    
    // Add search parameters (filter out null and undefined)
    if (params.query != null) searchParams.set("query", params.query);
    if (params.songSort != null) searchParams.set("songSort", params.songSort);
    if (params.songSortDir != null) searchParams.set("songSortDir", params.songSortDir);
    if (params.minYear != null) searchParams.set("minYear", String(params.minYear));
    if (params.maxYear != null) searchParams.set("maxYear", String(params.maxYear));
    if (params.genre != null) searchParams.set("genre", params.genre);
    if (params.minDuration != null) searchParams.set("minDuration", String(params.minDuration));
    if (params.maxDuration != null) searchParams.set("maxDuration", String(params.maxDuration));
    if (params.minRating != null) searchParams.set("minRating", String(params.minRating));
    if (params.maxRating != null) searchParams.set("maxRating", String(params.maxRating));
    if (params.starredOnly != null) searchParams.set("starredOnly", String(params.starredOnly));
    if (params.minPlayCount != null) searchParams.set("minPlayCount", String(params.minPlayCount));
    if (params.maxPlayCount != null) searchParams.set("maxPlayCount", String(params.maxPlayCount));
    if (params.shuffleExcludedOnly != null) searchParams.set("shuffleExcludedOnly", String(params.shuffleExcludedOnly));
    if (params.minBitrate != null) searchParams.set("minBitrate", String(params.minBitrate));
    if (params.maxBitrate != null) searchParams.set("maxBitrate", String(params.maxBitrate));
    if (params.addedAfter != null) searchParams.set("addedAfter", params.addedAfter);
    if (params.addedBefore != null) searchParams.set("addedBefore", params.addedBefore);

    const queryString = searchParams.toString();
    const endpoint = queryString ? `/ferrotune/songs/ids?${queryString}` : "/ferrotune/songs/ids";
    return this.adminRequest<SongIdsResponse>(endpoint);
  }

  // Tag management endpoints (Admin API)
  async getSongTags(id: string): Promise<GetTagsResponse> {
    return this.adminRequest(`/ferrotune/songs/${encodeURIComponent(id)}/tags`);
  }

  async updateSongTags(id: string, request: UpdateTagsRequest): Promise<UpdateTagsResponse> {
    return this.adminRequest(`/ferrotune/songs/${encodeURIComponent(id)}/tags`, {
      method: "PATCH",
      body: JSON.stringify(request),
    });
  }

  // User preferences endpoints (Admin API)
  async getPreferences(): Promise<UserPreferences> {
    return this.adminRequest("/ferrotune/preferences");
  }

  async updatePreferences(request: UpdatePreferencesRequest): Promise<UserPreferences> {
    return this.adminRequest("/ferrotune/preferences", {
      method: "PUT",
      body: JSON.stringify(request),
    });
  }

  async getPreference<T = unknown>(key: string): Promise<{ key: string; value: T | null }> {
    return this.adminRequest(`/ferrotune/preferences/${encodeURIComponent(key)}`);
  }

  async setPreference<T = unknown>(key: string, value: T): Promise<{ key: string; value: T }> {
    return this.adminRequest(`/ferrotune/preferences/${encodeURIComponent(key)}`, {
      method: "PUT",
      body: JSON.stringify({ value }),
    });
  }

  async deletePreference(key: string): Promise<void> {
    await this.adminRequest(`/ferrotune/preferences/${encodeURIComponent(key)}`, {
      method: "DELETE",
    });
  }

  // Server statistics endpoint (Admin API)
  async getStats(): Promise<ServerStats> {
    return this.adminRequest("/ferrotune/stats");
  }

  // Playlist management (Admin API)
  async reorderPlaylistSongs(playlistId: string, songIds: string[]): Promise<void> {
    await this.adminRequest(`/ferrotune/playlists/${encodeURIComponent(playlistId)}/reorder`, {
      method: "PUT",
      body: JSON.stringify({ songIds }),
    });
  }

  // Listening statistics (Admin API)
  async logListening(songId: string, durationSeconds: number, sessionId?: number): Promise<{ success: boolean; sessionId: number }> {
    return this.adminRequest("/ferrotune/listening", {
      method: "POST",
      body: JSON.stringify({ songId, durationSeconds, sessionId }),
    });
  }

  async getListeningStats(): Promise<ListeningStatsResponse> {
    return this.adminRequest("/ferrotune/listening/stats");
  }

  async getPeriodReview(year?: number, month?: number): Promise<PeriodReviewResponse> {
    const params = new URLSearchParams();
    if (year !== undefined) params.set("year", year.toString());
    if (month !== undefined) params.set("month", month.toString());
    const query = params.toString();
    return this.adminRequest(`/ferrotune/listening/review${query ? `?${query}` : ""}`);
  }

  // Waveform data (Admin API)
  async getWaveform(songId: string, resolution: number = 200): Promise<{ heights: number[]; peak_rms: number }> {
    const url = `${this.buildAdminUrl(`/ferrotune/songs/${encodeURIComponent(songId)}/waveform`)}?resolution=${resolution}`;
    
    const headers: Record<string, string> = {};
    if (this.username && this.password) {
      headers["Authorization"] = `Basic ${btoa(`${this.username}:${this.password}`)}`;
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `HTTP error: ${response.status}`);
    }

    return response.json();
  }

  // Streaming waveform URL (Admin API - returns URL for SSE endpoint)
  getWaveformStreamUrl(songId: string, resolution: number = 200): string {
    // Build URL with resolution param
    const baseUrl = this.buildAdminUrl(`/ferrotune/songs/${encodeURIComponent(songId)}/waveform/stream`);
    const params = new URLSearchParams({
      resolution: resolution.toString(),
    });
    return `${baseUrl}?${params.toString()}`;
  }

  // Get auth headers for streaming requests
  getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.username && this.password) {
      headers["Authorization"] = `Basic ${btoa(`${this.username}:${this.password}`)}`;
    }
    return headers;
  }

  // Shuffle exclude endpoints (Admin API)
  async getShuffleExcludeStatus(songId: string): Promise<{ songId: string; excluded: boolean }> {
    return this.adminRequest(`/ferrotune/songs/${encodeURIComponent(songId)}/shuffle-exclude`);
  }

  async setShuffleExclude(songId: string, excluded: boolean): Promise<{ songId: string; excluded: boolean }> {
    const url = this.buildAdminUrl(`/ferrotune/songs/${encodeURIComponent(songId)}/shuffle-exclude`);
    
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.username && this.password) {
      headers["Authorization"] = `Basic ${btoa(`${this.username}:${this.password}`)}`;
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
    return this.adminRequest("/ferrotune/shuffle-excludes");
  }

  async bulkSetShuffleExcludes(songIds: string[], excluded: boolean): Promise<{ count: number; excluded: boolean }> {
    return this.adminRequest("/ferrotune/shuffle-excludes/bulk", {
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
    shuffle?: boolean;
    repeatMode?: string;
    filters?: Record<string, unknown>;
    sort?: Record<string, unknown>;
    /** Explicit song IDs to use instead of materializing from source */
    songIds?: string[];
  }): Promise<StartQueueResponse> {
    return this.adminRequest("/ferrotune/queue/start", {
      method: "POST",
      body: JSON.stringify(params),
    });
  }

  /**
   * Get the current queue state with optional pagination
   */
  async getServerQueue(params: { offset?: number; limit?: number } = {}): Promise<GetQueueResponse> {
    const query = new URLSearchParams();
    if (params.offset !== undefined) query.set("offset", String(params.offset));
    if (params.limit !== undefined) query.set("limit", String(params.limit));
    const queryStr = query.toString();
    return this.adminRequest(`/ferrotune/queue${queryStr ? `?${queryStr}` : ""}`);
  }

  /**
   * Get songs around the current position
   */
  async getQueueCurrentWindow(radius: number = 20): Promise<GetQueueResponse> {
    return this.adminRequest(`/ferrotune/queue/current-window?radius=${radius}`);
  }

  /**
   * Add songs to the queue
   */
  async addToServerQueue(params: {
    songIds: string[];
    position: "next" | "end" | number;
  }): Promise<QueueSuccessResponse> {
    return this.adminRequest("/ferrotune/queue/add", {
      method: "POST",
      body: JSON.stringify({
        songIds: params.songIds,
        position: params.position,
      }),
    });
  }

  /**
   * Remove a song from the queue at a position
   */
  async removeFromServerQueue(position: number): Promise<QueueSuccessResponse> {
    return this.adminRequest(`/ferrotune/queue/${position}`, {
      method: "DELETE",
    });
  }

  /**
   * Move a song from one position to another
   */
  async moveInServerQueue(fromPosition: number, toPosition: number): Promise<QueueSuccessResponse> {
    return this.adminRequest("/ferrotune/queue/move", {
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
    return this.adminRequest("/ferrotune/queue/shuffle", {
      method: "POST",
      body: JSON.stringify({ enabled }),
    });
  }

  /**
   * Update the current playback position
   */
  async updateServerQueuePosition(currentIndex: number, positionMs: number = 0): Promise<QueueSuccessResponse> {
    return this.adminRequest("/ferrotune/queue/position", {
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
  async updateServerRepeatMode(mode: "off" | "all" | "one"): Promise<QueueSuccessResponse> {
    return this.adminRequest("/ferrotune/queue/repeat", {
      method: "POST",
      body: JSON.stringify({ mode }),
    });
  }

  /**
   * Clear the entire queue
   */
  async clearServerQueue(): Promise<QueueSuccessResponse> {
    return this.adminRequest("/ferrotune/queue", {
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
    return this.adminRequest("/ferrotune/scan", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  /**
   * Cancel an in-progress scan
   */
  async cancelScan(): Promise<{ status: string; message: string }> {
    return this.adminRequest("/ferrotune/scan/cancel", {
      method: "POST",
    });
  }

  // ==========================================
  // Music Folder Management (Admin API)
  // ==========================================

  /**
   * List all music folders with their stats (Admin API)
   */
  async getAdminMusicFolders(): Promise<MusicFoldersAdminResponse> {
    return this.adminRequest("/ferrotune/music-folders");
  }

  /**
   * Get a single music folder with stats
   */
  async getAdminMusicFolder(id: number): Promise<MusicFolderInfo> {
    return this.adminRequest(`/ferrotune/music-folders/${id}`);
  }

  /**
   * Create a new music folder
   */
  async createMusicFolder(name: string, path: string): Promise<CreateMusicFolderResponse> {
    return this.adminRequest("/ferrotune/music-folders", {
      method: "POST",
      body: JSON.stringify({ name, path }),
    });
  }

  /**
   * Update a music folder (name and/or enabled status)
   */
  async updateMusicFolder(id: number, updates: { name?: string; enabled?: boolean }): Promise<void> {
    await this.adminRequest(`/ferrotune/music-folders/${id}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
  }

  /**
   * Delete a music folder and all its songs
   */
  async deleteMusicFolder(id: number): Promise<void> {
    await this.adminRequest(`/ferrotune/music-folders/${id}`, {
      method: "DELETE",
    });
  }

  /**
   * Get current scan status
   */
  async getScanStatus(): Promise<ScanStatusResponse> {
    return this.adminRequest("/ferrotune/scan/status");
  }

  /**
   * Get recent scan logs
   */
  async getScanLogs(): Promise<ScanLogsResponse> {
    return this.adminRequest("/ferrotune/scan/logs");
  }

  /**
   * Get full scan status including progress and logs
   */
  async getFullScanStatus(): Promise<FullScanStatusResponse> {
    return this.adminRequest("/ferrotune/scan/full");
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
    return this.adminRequest("/ferrotune/users/me");
  }

  /**
   * List all users (admin only)
   */
  async getUsers(): Promise<UsersResponse> {
    return this.adminRequest("/ferrotune/users");
  }

  /**
   * Get a single user by ID (admin only)
   */
  async getUser(id: number): Promise<UserInfo> {
    return this.adminRequest(`/ferrotune/users/${id}`);
  }

  /**
   * Create a new user (admin only)
   */
  async createUser(request: CreateUserRequest): Promise<CreateUserResponse> {
    return this.adminRequest("/ferrotune/users", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  /**
   * Update a user (admin only)
   */
  async updateUser(id: number, request: UpdateUserRequest): Promise<UserInfo> {
    return this.adminRequest(`/ferrotune/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(request),
    });
  }

  /**
   * Delete a user (admin only)
   */
  async deleteUser(id: number): Promise<void> {
    await this.adminRequest(`/ferrotune/users/${id}`, {
      method: "DELETE",
    });
  }

  /**
   * Get a user's library access (admin only)
   */
  async getUserLibraryAccess(userId: number): Promise<LibraryAccessResponse> {
    return this.adminRequest(`/ferrotune/users/${userId}/library-access`);
  }

  /**
   * Set a user's library access (admin only)
   */
  async setUserLibraryAccess(userId: number, folderIds: number[]): Promise<LibraryAccessResponse> {
    return this.adminRequest(`/ferrotune/users/${userId}/library-access`, {
      method: "PUT",
      body: JSON.stringify({ folderIds } as SetLibraryAccessRequest),
    });
  }

  /**
   * Get a user's API keys (admin or self)
   */
  async getUserApiKeys(userId: number): Promise<ApiKeysResponse> {
    return this.adminRequest(`/ferrotune/users/${userId}/api-keys`);
  }

  /**
   * Create an API key for a user (admin or self)
   */
  async createUserApiKey(userId: number, name: string): Promise<CreateApiKeyResponse> {
    return this.adminRequest(`/ferrotune/users/${userId}/api-keys`, {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  }

  /**
   * Delete an API key for a user (admin or self)
   */
  async deleteUserApiKey(userId: number, keyName: string): Promise<void> {
    await this.adminRequest(`/ferrotune/users/${userId}/api-keys/${encodeURIComponent(keyName)}`, {
      method: "DELETE",
    });
  }

  // ==========================================
  // Server Configuration (Admin API)
  // ==========================================

  /**
   * Get server configuration (admin only)
   */
  async getServerConfig(): Promise<ServerConfigResponse> {
    return this.adminRequest("/ferrotune/config");
  }

  /**
   * Update server configuration (admin only)
   */
  async updateServerConfig(request: UpdateServerConfigRequest): Promise<ServerConfigResponse> {
    return this.adminRequest("/ferrotune/config", {
      method: "PUT",
      body: JSON.stringify(request),
    });
  }
}

// Singleton instance - will be initialized when user connects
let clientInstance: SubsonicClient | null = null;

export function initializeClient(connection: ServerConnection): SubsonicClient {
  clientInstance = new SubsonicClient(connection);
  return clientInstance;
}

export function getClient(): SubsonicClient | null {
  return clientInstance;
}

export function clearClient(): void {
  clientInstance = null;
}
