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
} from "./types";

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

  async getArtist(id: string): Promise<ArtistDetailResponse> {
    return this.request<ArtistDetailResponse>("getArtist", { id });
  }

  async getAlbum(id: string): Promise<AlbumDetailResponse> {
    return this.request<AlbumDetailResponse>("getAlbum", { id });
  }

  async getSong(id: string): Promise<SongDetailResponse> {
    return this.request<SongDetailResponse>("getSong", { id });
  }

  async getGenres(): Promise<GenresResponse> {
    return this.request<GenresResponse>("getGenres");
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

  async getPlaylist(id: string): Promise<PlaylistWithSongsResponse> {
    return this.request<PlaylistWithSongsResponse>("getPlaylist", { id });
  }

  async createPlaylist(params: { name: string; songId?: string[] }): Promise<PlaylistWithSongsResponse> {
    const urlParams: Record<string, string> = { name: params.name };
    // Note: songId handling for arrays would need URL construction adjustment
    return this.request<PlaylistWithSongsResponse>("createPlaylist", urlParams);
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
  async getPlayHistory(params: { size?: number; offset?: number } = {}): Promise<PlayHistoryResponse> {
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
