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

export interface SearchResponse {
  searchResult3: {
    artist?: Artist[];
    album?: Album[];
    song?: Song[];
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

// Connection settings
export interface ServerConnection {
  serverUrl: string;
  apiKey?: string;
  username?: string;
  password?: string;
}
