import type {
  SubsonicResponse,
  ServerConnection,
  PingResponse,
  MusicFoldersResponse,
  ArtistsResponse,
  ArtistResponse,
  AlbumResponse,
  SongResponse,
  GenresResponse,
  AlbumListResponse,
  RandomSongsResponse,
  SearchResponse,
  StarredResponse,
  PlaylistsResponse,
  PlaylistResponse,
  AlbumListParams,
  SearchParams,
  RandomSongsParams,
} from "./types";

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

  private buildUrl(endpoint: string, params: Record<string, string | number | boolean | undefined> = {}): string {
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

    // Add custom params
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    return url.toString();
  }

  private async request<T>(endpoint: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
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

  async getArtist(id: string): Promise<ArtistResponse> {
    return this.request<ArtistResponse>("getArtist", { id });
  }

  async getAlbum(id: string): Promise<AlbumResponse> {
    return this.request<AlbumResponse>("getAlbum", { id });
  }

  async getSong(id: string): Promise<SongResponse> {
    return this.request<SongResponse>("getSong", { id });
  }

  async getGenres(): Promise<GenresResponse> {
    return this.request<GenresResponse>("getGenres");
  }

  // List endpoints
  async getAlbumList2(params: AlbumListParams): Promise<AlbumListResponse> {
    return this.request<AlbumListResponse>("getAlbumList2", { ...params });
  }

  async getRandomSongs(params: RandomSongsParams = {}): Promise<RandomSongsResponse> {
    return this.request<RandomSongsResponse>("getRandomSongs", { ...params });
  }

  // Search endpoint
  async search3(params: SearchParams): Promise<SearchResponse> {
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

  async getPlaylist(id: string): Promise<PlaylistResponse> {
    return this.request<PlaylistResponse>("getPlaylist", { id });
  }

  async createPlaylist(params: { name: string; songId?: string[] }): Promise<PlaylistResponse> {
    const urlParams: Record<string, string> = { name: params.name };
    // Note: songId handling for arrays would need URL construction adjustment
    return this.request<PlaylistResponse>("createPlaylist", urlParams);
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
